import { splitVec2 } from '../common/math';
import { RgbaU32, Vec2 } from '../common/types';
import { Camera } from '../models/camera';

import { BillboardProgram } from './billboard_program';
import { Line } from './geometry';
import { LineCapProgram } from './line_cap_program';
import { LineProgram } from './line_program';
import { Drawable } from './program';
import { Renderer } from './renderer';
import { Glyph, SdfProgram } from './sdf_program';

const MAX_GEOMETRY_BYTES = 64_000_000;

export class RenderPlanner {

  private readonly drawables: Drawable[];
  private readonly geometry: ArrayBuffer;
  private readonly geometryBuffer: WebGLBuffer;
  private geometryByteSize: number;

  private readonly billboardProgram: BillboardProgram;
  private readonly lineCapProgram: LineCapProgram;
  private readonly lineProgram: LineProgram;
  private readonly sdfProgram: SdfProgram;

  constructor(private area: Vec2, private readonly renderer: Renderer) {
    this.drawables = [];
    this.geometry = new ArrayBuffer(MAX_GEOMETRY_BYTES);
    this.geometryBuffer = renderer.createBuffer(MAX_GEOMETRY_BYTES);
    this.geometryByteSize = 0;

    this.billboardProgram = new BillboardProgram(renderer.gl);
    this.lineCapProgram = new LineCapProgram(renderer.gl);
    this.lineProgram = new LineProgram(renderer.gl);
    this.sdfProgram = new SdfProgram(renderer.gl);
  }

  clear(): void {
    this.drawables.length = 0;
    this.geometryByteSize = 0;
  }

  resize(area: Vec2): void {
    this.area = area;
  }

  save(): void {
    this.renderer.uploadGeometry(this.geometry, this.geometryByteSize, this.geometryBuffer);
    this.drawables.sort((a, b) => {
      if (a.z !== b.z) {
        return a.z - b.z;
      } else {
        return a.program.id - b.program.id;
      }
    });
  }

  render(camera: Camera): void {
    if (this.drawables.length === 0) {
      return;
    }

    this.renderer.uploadGeometry(this.geometry, this.geometryByteSize, this.geometryBuffer);

    const bounds = camera.viewportBounds(this.area[0], this.area[1]);

    const centerPixel = camera.centerPixel;
    const centerPixels = [splitVec2(centerPixel)];
    // Add extra camera positions for wrapping the world
    //
    // There's some weird normalization bug at
    // lat=42.3389265&lng=177.6919189&zoom=3.020
    // where tiles don't show up around the wrap. Seems like S2 sometimes normalizes and sometimes
    // doesn't depending on the size of the range. So we check the max/min.
    if (Math.min(bounds.lng().lo(), bounds.lng().hi()) < -Math.PI) {
      centerPixels.push(splitVec2([centerPixel[0] + 2, centerPixel[1]]));
    }
    if (Math.max(bounds.lng().lo(), bounds.lng().hi()) > Math.PI) {
      centerPixels.push(splitVec2([centerPixel[0] - 2, centerPixel[1]]));
    }

    let drawStart = this.drawables[0];
    let drawStartIndex = 0;
    // Gather sequential drawables that share the same program and draw them all at once
    for (let i = 1; i < this.drawables.length; ++i) {
      const drawable = this.drawables[i];
      if (drawStart.program === drawable.program) {
        if (
            drawStart.instanced && drawable.instanced
                && drawStart.texture === drawable.texture
                && drawStart.offset + drawStart.instanced.bytes === drawable.offset) {
          drawable.offset = drawStart.offset;
          drawable.instanced.bytes += drawStart.instanced.bytes;
          drawable.instanced.count += drawStart.instanced.count;
          drawStart.instanced.bytes = 0;
          drawStart.instanced.count = 0;
          drawStart = drawable;
          drawStartIndex = i;
        }

        continue;
      }

      drawStart.program.render(
          this.area, centerPixels, camera.worldRadius, this.drawables.slice(drawStartIndex, i));
      drawStart = drawable;
      drawStartIndex = i;
    }

    // The last batch didn't actually draw, so draw it
    drawStart.program.render(
        this.area, centerPixels, camera.worldRadius, this.drawables.slice(drawStartIndex, this.drawables.length));
  }

  addAtlasedBillboard(
      center: Vec2,
      offsetPx: Vec2,
      size: Vec2,
      atlasIndex: number,
      atlasSize: Vec2,
      texture: WebGLTexture,
      z: number,
      angle: number = 0): void {
    this.align(256);
    this.drawables.push({
      buffer: this.geometryBuffer,
      offset: this.geometryByteSize,
      program: this.billboardProgram,
      texture,
      z,
    });

    const bytes = this.billboardProgram.plan(
        center, offsetPx, size, angle, atlasIndex, atlasSize, this.geometry, this.geometryByteSize);
        this.geometryByteSize += bytes;
    this.align(256);
  }

  addBillboard(
      center: Vec2,
      offsetPx: Vec2,
      size: Vec2,
      texture: WebGLTexture,
      z: number,
      angle: number = 0): void {
    this.addAtlasedBillboard(center, offsetPx, size, 0, [1, 1], texture, z, angle);
  }

  addLines(
      lines: Line[],
      radius: number,
      z: number,
      replace: boolean = true,
      round: boolean = true): void {
    const drawable =
        this.lineProgram.plan(lines, radius, replace, this.geometry, this.geometryByteSize);

    if (round) {
      this.drawables.push({
        buffer: this.geometryBuffer,
        instanced: drawable.instanced,
        offset: this.geometryByteSize,
        program: this.lineCapProgram,
        z,
      });
    }

    this.drawables.push({
      buffer: this.geometryBuffer,
      instanced: drawable.instanced,
      offset: this.geometryByteSize,
      program: this.lineProgram,
      z,
    });
    this.geometryByteSize += drawable.instanced.bytes;
  }

  addGlyphs(
      glyphs: Glyph[],
      fill: RgbaU32,
      stroke: RgbaU32,
      scale: number,
      left: Vec2,
      offset: Vec2,
      angle: number,
      atlas: WebGLTexture,
      atlasGlyphSize: number) {
    const drawable =
        this.sdfProgram.plan(
            glyphs,
            fill,
            stroke,
            scale,
            left,
            offset,
            angle,
            atlas,
            atlasGlyphSize,
            this.geometry,
            this.geometryByteSize);
    this.drawables.push({
      ...drawable,
      buffer: this.geometryBuffer,
      offset: this.geometryByteSize,
      program: this.sdfProgram,
      z: 100, // ???
    });
    this.geometryByteSize += drawable.instanced.bytes;
  }

  private align(alignment: number): void {
    this.geometryByteSize =
        Math.trunc((this.geometryByteSize + alignment - 1) / alignment) * alignment;
  }
}


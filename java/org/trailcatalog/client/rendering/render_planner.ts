import { checkExists } from '../models/asserts';
import { Camera } from '../models/camera';
import { Vec2, Vec4 } from '../models/types';

export interface Line {
  colorFill: Vec4;
  colorStipple: Vec4;
  vertices: Float64Array;
}

export interface RenderPlan {
  billboards: Array<{
    center: Vec4;
    size: Vec4;
    sizeIsPixels: boolean;
    texture: WebGLTexture;
    z: number,
  }>;
  lines: Array<{
    offset: number;
    count: number;
  }>;
}

export class RenderPlanner {

  geometryByteSize: number;
  readonly target: RenderPlan;

  constructor(readonly geometry: ArrayBuffer) {
    this.geometryByteSize = 0;
    this.target = {
      billboards: [],
      lines: [],
    };
  }

  // TODO: z is currently implicit for lines, terrible assumption

  addBillboard(center: Vec2, size: Vec2, texture: WebGLTexture, z: number): void {
    const x = center[0];
    const xF = Math.fround(x);
    const xR = x - xF;
    const y = center[1];
    const yF = Math.fround(y);
    const yR = y - yF;

    const w = size[0];
    const wF = Math.fround(w);
    const wR = w - wF;
    const h = size[1];
    const hF = Math.fround(h);
    const hR = h - hF;

    this.target.billboards.push({
      center: [xF, xR, yF, yR],
      size: [wF, wR, hF, hR],
      sizeIsPixels: size[0] >= 1, // well this is sketchy
      texture,
      z,
    });
  }

  addLines(lines: Line[]): void {
    const stride = 4 + 4 + 4 + 4 + 1 + 1;
    const vertices = new Float32Array(this.geometry, this.geometryByteSize);
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = line.vertices;
      let distanceAlong = 0;
      for (let i = 0; i < doubles.length - 2; i += 2) {
        const x = doubles[i + 0];
        const y = doubles[i + 1];
        const xp = doubles[i + 2];
        const yp = doubles[i + 3];

        const xF = Math.fround(x);
        const xR = x - xF;
        const yF = Math.fround(y);
        const yR = y - yF;
        const xpF = Math.fround(xp);
        const xpR = xp - xpF;
        const ypF = Math.fround(yp);
        const ypR = yp - ypF;

        vertices.set([
          xF, xR, yF, yR,
          xpF, xpR, ypF, ypR,
          ...line.colorFill,
          ...line.colorStipple,
          distanceAlong,
          3,
        ], vertexOffset);

        const dx = xp - x;
        const dy = yp - y;
        distanceAlong += Math.sqrt(dx * dx + dy * dy);
        vertexOffset += stride;
      }
    }

    this.target.lines.push({
      offset: this.geometryByteSize,
      count: vertexOffset / stride,
    });
    this.geometryByteSize += 4 * vertexOffset;
  }
}

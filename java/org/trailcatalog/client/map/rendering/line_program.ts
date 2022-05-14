import { checkExists } from '../../common/asserts';
import { splitVec2 } from '../../common/math';

import { Line } from './geometry';
import { Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

interface LineDrawable {
  bytes: number;
  instances: number;
}

/** Renders instanced lines as rectangles without mitering. */
export class LineProgram extends Program<LineProgramData> {

  private readonly lineBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createLineProgram(gl), gl);
    this.lineBuffer =
        this.createStaticBuffer(
                new Float32Array([
                  0, -1,
                  0, 1,
                  1, -1,
                  1, 1,
                ]));
  }

  plan(lines: Line[], vertices: Float32Array): LineDrawable {
    const stride = 4 + 4 + 4 + 4 + 1 + 1;
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = line.vertices;
      // TODO(april): not needed right now, so not calculating
      let distanceAlong = 0;
      for (let i = 0; i < doubles.length - 2; i += 2) {
        const x = doubles[i + 0];
        const y = doubles[i + 1];
        const xp = doubles[i + 2];
        const yp = doubles[i + 3];

        const xF = Math.fround(x);
        const xR = x - xF;
        vertices[vertexOffset + 0] = xF;
        vertices[vertexOffset + 1] = xR;
        const yF = Math.fround(y);
        const yR = y - yF;
        vertices[vertexOffset + 2] = yF;
        vertices[vertexOffset + 3] = yR;
        const xpF = Math.fround(xp);
        const xpR = xp - xpF;
        vertices[vertexOffset + 4] = xpF;
        vertices[vertexOffset + 5] = xpR;
        const ypF = Math.fround(yp);
        const ypR = yp - ypF;
        vertices[vertexOffset + 6] = ypF;
        vertices[vertexOffset + 7] = ypR;

        vertices.set(line.colorFill, vertexOffset + 8);
        vertices.set(line.colorStroke, vertexOffset + 12);
        vertices[vertexOffset + 16] = 0;
        vertices[vertexOffset + 17] = 3;

        vertexOffset += stride;
      }
    }

    return {
      bytes: 4 * vertexOffset,
      instances: vertexOffset / stride,
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.useProgram(this.program.id);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 0,
        /* offset= */ 0);

    gl.enableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorFill, 1);
    gl.enableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 1);
    gl.enableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 1);
    gl.enableVertexAttribArray(this.program.attributes.previous);
    gl.vertexAttribDivisor(this.program.attributes.previous, 1);
    gl.enableVertexAttribArray(this.program.attributes.next);
    gl.vertexAttribDivisor(this.program.attributes.next, 1);
    gl.enableVertexAttribArray(this.program.attributes.radius);
    gl.vertexAttribDivisor(this.program.attributes.radius, 1);
  }

  protected bind(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.colorFill,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 32);
    gl.vertexAttribPointer(
        this.program.attributes.colorStroke,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 48);
    gl.vertexAttribPointer(
        this.program.attributes.distanceAlong,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 64);
    gl.vertexAttribPointer(
        this.program.attributes.previous,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.next,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.radius,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 68);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);

    gl.vertexAttribDivisor(this.program.attributes.colorFill, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 0);
    gl.disableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.previous, 0);
    gl.disableVertexAttribArray(this.program.attributes.previous);
    gl.vertexAttribDivisor(this.program.attributes.next, 0);
    gl.disableVertexAttribArray(this.program.attributes.next);
    gl.vertexAttribDivisor(this.program.attributes.radius, 0);
    gl.disableVertexAttribArray(this.program.attributes.radius);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
  }
}

interface LineProgramData extends ProgramData {
  attributes: {
    colorFill: number;
    colorStroke: number;
    distanceAlong: number;
    next: number;
    position: number;
    previous: number;
    radius: number;
  }
}

function createLineProgram(gl: WebGL2RenderingContext): LineProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;

      // x is either 0 or 1, y is either -0.5 or 0.5.
      in highp vec2 position;

      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      in highp vec4 previous;
      in highp float distanceAlong;
      in highp vec4 next;

      in lowp vec4 colorFill;
      in lowp vec4 colorStroke;
      // This is a radius in pixels
      in highp float radius;

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStroke;
      out lowp float fragRadius;
      out highp float fragDistanceAlong;
      out highp float fragDistanceOrtho;

      ${FP64_OPERATIONS}

      void main() {
        vec4 direction = next - previous;
        vec4 perpendicular = perpendicular64(normalize64(direction));
        vec4 location = -cameraCenter + previous + direction * position.x;
        vec4 worldCoord = location * halfWorldSize + perpendicular * radius * position.y;
        gl_Position = vec4(reduce64(divide2Into64(worldCoord, halfViewportSize)), 0, 1);

        float worldDistanceAlong = distanceAlong + magnitude64(direction) * position.x;
        fragDistanceAlong = 256. * pow(2., 17.) * worldDistanceAlong;
        fragDistanceAlong = halfWorldSize * worldDistanceAlong;

        fragColorFill = colorFill;
        fragColorStroke = colorStroke;
        fragRadius = radius;
        fragDistanceOrtho = position.y * radius;
      }
    `;
  const fs = `#version 300 es

      in lowp vec4 fragColorFill;
      in lowp vec4 fragColorStroke;
      in lowp float fragRadius;
      in highp float fragDistanceAlong;
      in highp float fragDistanceOrtho;

      out lowp vec4 fragColor;

      void main() {
        mediump float o = abs(fragDistanceOrtho);
        mediump vec4 color = mix(fragColorFill, fragColorStroke, o / fragRadius);
        mediump float alpha = o < fragRadius - 0.5 ? 1. : 2. * (fragRadius - o);
        fragColor = vec4(color.rgb, mix(0., color.a, alpha));
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile line vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile line fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link line program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    id: programId,
    instanceSize: 18 * 4,
    vertexCount: 4,
    attributes: {
      colorFill: checkExists(gl.getAttribLocation(programId, 'colorFill')),
      colorStroke: checkExists(gl.getAttribLocation(programId, 'colorStroke')),
      distanceAlong: checkExists(gl.getAttribLocation(programId, 'distanceAlong')),
      next: checkExists(gl.getAttribLocation(programId, 'next')),
      position: checkExists(gl.getAttribLocation(programId, 'position')),
      previous: checkExists(gl.getAttribLocation(programId, 'previous')),
      radius: checkExists(gl.getAttribLocation(programId, 'radius')),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
    },
  };
}


import { PixelRect, Vec2 } from './models/types';

export function worldBounds<V>(): BoundsQuadtree<V> {
  return new BoundsQuadtree([0, 0], 0.5);
}

const SPLIT_THRESHOLD = 100;
const MIN_HALF_RADIUS = 1 / Math.pow(2, 15);

export class BoundsQuadtree<V> {
  private readonly values: Array<[V, PixelRect]>;
  private children: [
    BoundsQuadtree<V>,
    BoundsQuadtree<V>,
    BoundsQuadtree<V>,
    BoundsQuadtree<V>,
  ]|undefined;

  constructor(private readonly center: Vec2, private readonly halfRadius: number) {
    this.values = [];
  }

  insert(value: V, bound: PixelRect): void {
    if ((bound.low[0] <= this.center[0] && this.center[0] <= bound.high[0]) ||
        (bound.low[1] <= this.center[1] && this.center[1] <= bound.high[1])) {
      this.values.push([value, bound]);
      return;
    }

    if (this.children) {
      // We know that the bound is fully contained by a child, so we can just test any point.
      const xi = (bound.low[0] <= this.center[0]) as unknown as number;
      const yi = (bound.low[1] <= this.center[1]) as unknown as number;
      const child = this.children[(xi << 1) + yi];
      child.insert(value, bound);
      return;
    }

    if (this.halfRadius > MIN_HALF_RADIUS && this.values.length + 1 >= SPLIT_THRESHOLD) {
      const halfHalfRadius = this.halfRadius / 2;
      this.children = [
          new BoundsQuadtree<V>(
              [this.center[0] + this.halfRadius, this.center[1] + this.halfRadius],
              halfHalfRadius),
          new BoundsQuadtree<V>(
              [this.center[0] + this.halfRadius, this.center[1] - this.halfRadius],
              halfHalfRadius),
          new BoundsQuadtree<V>(
              [this.center[0] - this.halfRadius, this.center[1] + this.halfRadius],
              halfHalfRadius),
          new BoundsQuadtree<V>(
              [this.center[0] - this.halfRadius, this.center[1] - this.halfRadius],
              halfHalfRadius),
      ];

      const items = [...this.values];
      this.values.length = 0;
      for (const [sv, sb] of items) {
        this.insert(sv, sb);
      }
      this.insert(value, bound);
    } else {
      this.values.push([value, bound]);
    }
  }

  query(point: Vec2, radius: number, output: V[]): void {
    for (const [value, bound] of this.values) {
      if (intersectCircleAabb(point, radius, bound)) {
        output.push(value);
      }
    }

    if (this.children) {
      const cx = this.center[0];
      const cy = this.center[1];
      if (point[0] - radius <= cx) {
        if (point[1] - radius <= cy) {
          this.children[3].query(point, radius, output);
        }
        if (point[1] + radius > cy) {
          this.children[2].query(point, radius, output);
        }
      }
      if (point[0] + radius > cx) {
        if (point[1] - radius <= cy) {
          this.children[1].query(point, radius, output);
        }
        if (point[1] + radius > cy) {
          this.children[0].query(point, radius, output);
        }
      }
    }
  }
}

function intersectAabbAabb(a: PixelRect, b: PixelRect): boolean {
  if (a.low[0] > b.high[0] || b.low[0] > a.high[0]) {
    return false;
  } else if (a.low[1] > b.high[1] || b.low[1] > a.high[1]) {
    return false;
  } else {
    return true;
  }
}

function intersectCircleAabb(point: Vec2, radius: number, b: PixelRect): boolean {
  // Is the circle inside the rectangle?
  if (b.low[0] <= point[0] && point[0] <= b.high[0]
     && b.low[1] <= point[1] && point[1] <= b.high[1]) {
    return true;
  }
  // Find the center of the rectangle
  const halfWidth = (b.high[0] - b.low[0]) / 2;
  const halfHeight = (b.high[1] - b.low[1]) / 2;
  // Find the vector to the circle
  const dx = point[0] - (b.low[0] + halfWidth);
  const dy = point[1] - (b.low[1] + halfHeight);
  // Find the closest point to the circle
  const cx = clamp(-halfWidth, dx, halfWidth);
  const cy = clamp(-halfHeight, dy, halfHeight);
  // Check if that closest point lies inside the circle
  const dxPrime = point[0] - (b.low[0] + cx);
  const dyPrime = point[1] - (b.low[1] + cy);
  return dxPrime * dxPrime + dyPrime * dyPrime <= radius * radius;
}

function clamp(low: number, v: number, high: number): number {
  return Math.min(Math.max(low, v), high);
}


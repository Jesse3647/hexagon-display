import type { Part } from './types';

/** Minimum XY distance between exported bounding boxes, including every rail (mm). */
export const PRINT_PART_GAP = 2.5;

/**
 * Spreads an assembly's positions uniformly, retaining stagger, holes and orientation.
 * Only translations grow; meshes, dimensions and backs at Z=0 remain unchanged.
 * @param parts Selected source/preview bodies in stable order; never mutated.
 * @returns New placement records borrowing the original read-only meshes/bounds.
 * Multi-part layouts are translated into positive XY after spacing. Single bodies
 * retain their placement. Coupons with baked coordinates share a local origin,
 * so their bounds centers supply distinct expansion anchors instead.
 * @throws If coincident anchors cannot be separated by expanding their positions.
 * No printer bed size is assumed; large sets may need multiple plates. The gap is
 * for layer-by-layer printing, not sequential toolhead clearance or arbitrary brims.
 */
export function spacePartsForPrinting(parts: readonly Part[]): Part[] {
  if (parts.length < 2) return parts.map((part) => ({ ...part }));
  const bakedPositions = parts.every(
    (p) => p.x === parts[0].x && p.y === parts[0].y,
  );
  const anchors = parts.map((p) =>
    [p.x, p.y].map(
      (position, axis) =>
        position +
        (bakedPositions ? (p.bounds.min[axis] + p.bounds.max[axis]) / 2 : 0),
    ),
  );
  let scale = 1;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      // Either an X lane or a Y lane separates a pair's entire bounding boxes.
      // Solve the required expansion on each axis and choose the smaller one.
      const required = [0, 1].map((axis) => {
        const delta = anchors[j][axis] - anchors[i][axis];
        const [low, high] =
          delta >= 0 ? [parts[i], parts[j]] : [parts[j], parts[i]];
        const lowPosition = axis === 0 ? low.x : low.y;
        const highPosition = axis === 0 ? high.x : high.y;
        const gap =
          highPosition +
          high.bounds.min[axis] -
          lowPosition -
          low.bounds.max[axis];
        if (Math.abs(delta) < 1e-9) return gap >= PRINT_PART_GAP ? 1 : Infinity;
        return 1 + (PRINT_PART_GAP - gap) / Math.abs(delta);
      });
      scale = Math.max(scale, Math.min(...required));
    }
  }
  if (!Number.isFinite(scale))
    throw new Error(
      'Parts have coincident positions and cannot be spaced for printing.',
    );
  const expanded = parts.map((part, i) => ({
    ...part,
    x: part.x + (scale - 1) * anchors[i][0],
    y: part.y + (scale - 1) * anchors[i][1],
  }));
  const minX = Math.min(...expanded.map((p) => p.x + p.bounds.min[0]));
  const minY = Math.min(...expanded.map((p) => p.y + p.bounds.min[1]));
  return expanded.map((part) => ({
    ...part,
    x: part.x - minX,
    y: part.y - minY,
  }));
}

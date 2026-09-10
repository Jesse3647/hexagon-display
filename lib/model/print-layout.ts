import type { Part } from './types';

/** Minimum XY distance between exported bounding boxes, including every rail (mm). */
export const PRINT_PART_GAP = 5;

/**
 * Places multiple bodies on a regular print grid with 5 mm empty lanes.
 * Uses actual mesh bounds, including rails and half-pod floors. No rotation or
 * scaling is applied, so backs stay at Z=0 and connector orientation is preserved.
 * @param parts Selected source/preview bodies in stable order; never mutated.
 * @returns New placement records borrowing the original read-only meshes/bounds.
 * A single body keeps its original position. No printer bed size is assumed;
 * large sets may need splitting across plates in the slicer. Spacing is for
 * layer-by-layer printing, not sequential toolhead clearance or arbitrary brims.
 */
export function spacePartsForPrinting(parts: readonly Part[]): Part[] {
  if (parts.length < 2) return parts.map((part) => ({ ...part }));
  const columns = Math.ceil(Math.sqrt(parts.length));
  const width = Math.max(
    ...parts.map((p) => p.bounds.max[0] - p.bounds.min[0]),
  );
  const height = Math.max(
    ...parts.map((p) => p.bounds.max[1] - p.bounds.min[1]),
  );
  return parts.map((part, index) => ({
    ...part,
    x: (index % columns) * (width + PRINT_PART_GAP) - part.bounds.min[0],
    y:
      Math.floor(index / columns) * (height + PRINT_PART_GAP) -
      part.bounds.min[1],
  }));
}

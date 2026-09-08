/**
 * Shared configuration and mesh contracts for UI, workers, validation and export.
 * Distances are millimeters and volumes are cubic millimeters. Viewed from the
 * open front, +X is right and +Y is up; the back lies at Z=0 and +Z points out
 * of the opening. SVG diagrams negate Y; export coordinates never do.
 */
/** Counterclockwise edge order, beginning 30 degrees above +X; used by normal(). */
export const EDGES = ['NE', 'N', 'NW', 'SW', 'S', 'SE'] as const;
/** An edge name in the fixed front-facing orientation, independent of camera rotation. */
export type Edge = (typeof EDGES)[number];
/** Full hexagon or upper-half trapezoid; half pods are never rotated. */
export type PodKind = 'full' | 'half';
/** Grid edit value; empty cells remain selectable so users can restore them. */
export type CellKind = PodKind | 'empty';
/** Fixed rail genders; every other available edge uses a female channel. */
export const MALE: readonly Edge[] = ['N', 'NE', 'SE'];
/** The half pod has no connectors along its flat bottom. */
export const HALF_EDGES: readonly Edge[] = ['NE', 'N', 'NW'];
/** Maps an edge to the facing edge of its adjacent pod. */
export const OPPOSITE: Record<Edge, Edge> = {
  N: 'S',
  S: 'N',
  NE: 'SW',
  SW: 'NE',
  NW: 'SE',
  SE: 'NW',
};
/** Baseline pod and dovetail dimensions, in millimeters. */
export const DIM = {
  /** Full exterior height across the horizontal flats. */
  height: 34,
  /** Distance from the full hexagon center to a left/right vertex. */
  radius: 34 / Math.sqrt(3),
  /** Nominal clear opening height; the inner profile is derived by offsetting the walls. */
  opening: 30,
  /** Total back-to-front extent along +Z. */
  depth: 22.05,
  /** Solid back thickness from Z=0. */
  back: 2.4,
  /** Nominal wall thickness before cutting channels. */
  wall: 2,
  /** Female cavity depth inward from the exterior wall face. */
  channelDepth: 1.15,
  /** Nominal dovetail mouth width along the wall tangent. */
  seam: 3.4,
  /** Nominal dovetail width at the deepest part of the female cavity. */
  far: 5.4,
  /** Uncut wall length at the front of a female channel. */
  stop: 1.6,
  /** Axial length of the male rail tip taper. */
  lead: 1,
  /** Controls the taper shrinkage relative to the largest local profile extent. */
  tip: 0.12,
} as const;
/** Sample normal clearances per mating surface (mm), ordered from tightest to loosest. */
export const CALIBRATION_FITS = [0.1, 0.15, 0.2] as const;
/** Printer calibration settings shared by standalone pods and assemblies. */
export interface Clearances {
  /** Separation between neighboring exterior wall planes (mm). */
  wallGap: number;
  /** Normal clearance per mating connector surface, not total diametral clearance (mm). */
  fit: number;
  /** Space between a male rail tip and its female front stop (mm). */
  axial: number;
}
/** Starting points for calibration, not a guarantee of physical fit. */
export const DEFAULT_CLEARANCES: Clearances = {
  wallGap: 0.3,
  fit: 0.3,
  axial: 0.4,
};
/** Serializable user input; derived pods and adjacency belong in Layout instead. */
export interface Configuration {
  /** Selects standalone generation or the staggered grid. */
  mode: 'single' | 'assembly';
  /** Shape used in single mode; assembly shapes come from cells. */
  kind: PodKind;
  /** Single-mode edge toggles; unavailable half-pod edges are filtered by makeLayout. */
  enabled: Edge[];
  /** Common fit settings used for every pod and connector. */
  clearances: Clearances;
  /** Number of grid columns, an integer from 1 through 20. */
  columns: number;
  /** Full-pod cell count per column, an integer from 1 through 20. */
  rows: number;
  /** Sparse zero-based "column,row" edits; absent entries mean full pods. */
  cells: Record<string, CellKind>;
  /** Adds upper-half fillers where they can reach the assembly floor. */
  flatBase: boolean;
  /** Joint toggles keyed by pairKey, or exposed-edge toggles keyed by edgeOverrideKey. */
  overrides: Record<string, boolean>;
}
/** Returns independent mutable defaults: one full pod with all connectors closed. */
export const initialConfig = (): Configuration => ({
  mode: 'single',
  kind: 'full',
  enabled: [],
  clearances: { ...DEFAULT_CLEARANCES },
  columns: 3,
  rows: 3,
  cells: {},
  flatBase: false,
  overrides: {},
});
/** Derived placement; its mesh stays local and receives x/y translation only at display/export. */
export interface Pod {
  /** Stable selection key: "single", "column,row", or "base-column". */
  id: string;
  /** The printable full or upper-half profile. */
  kind: PodKind;
  /** Assembly-space X translation of the local pod origin (mm). */
  x: number;
  /** Assembly-space Y translation of the local pod origin (mm). */
  y: number;
  /** Raises a half pod floor above local Y=0 to align bottom fillers (mm). */
  baseTrim: number;
  /** Resolved connectors after adjacency and overrides have been applied. */
  enabled: Edge[];
  /** True for an automatically added bottom half, not a user-edited grid cell. */
  filler: boolean;
}
/** One compatible neighboring edge pair, retained even when its joint is disabled. */
export interface Connection {
  /** Order-independent pair key shared by both edge controls. */
  key: string;
  /** ID of the pod from whose edge this adjacency was discovered. */
  a: string;
  /** ID of the facing neighbor. */
  b: string;
  /** Available edge on a; the edge on b is OPPOSITE[edge]. */
  edge: Edge;
  /** Whether both sides of this joint are generated. */
  on: boolean;
  /** ID of the rail-bearing pod, defining the directed graph source. */
  male: string;
  /** ID of the channel-bearing pod, defining the directed graph destination. */
  female: string;
}
/** Geometry-free layout result; its removal order still needs solid collision validation. */
export interface Layout {
  /** Present cells and any derived fillers; removed cells are omitted. */
  pods: Pod[];
  /** Compatible adjacent pairs, including disabled joints. */
  connections: Connection[];
  /** Connected components of enabled joints, each an array of pod IDs. */
  groups: string[][];
  /** Pod IDs in graph-derived forward (+Z) removal order. */
  order: string[];
  /** Non-blocking layout explanations; empty layouts are rejected later by generation. */
  warnings: string[];
}
/** Indexed triangles shared by preview and exporters; treat the arrays as read-only. */
export interface MeshData {
  /** Packed local-space XYZ vertex coordinates (mm). */
  positions: Float32Array;
  /** Packed triangle vertex indices, three per outward-oriented triangle. */
  indices: Uint32Array;
}
/** A placed pod with one closed printable mesh; no neighboring bodies are merged. */
export interface Part extends Pod {
  /** Pod-local indexed mesh, without the placement x/y translation. */
  mesh: MeshData;
  /** Solid volume in cubic millimeters. */
  volume: number;
  /** Pod-local XYZ axis-aligned bounds in millimeters. */
  bounds: { min: number[]; max: number[] };
}
/** Worker-safe generation result. errors must be empty before any export is offered. */
export interface ModelResult {
  /** Separate closed pod bodies with placement metadata. */
  parts: Part[];
  /** Derived adjacency, groups and removal order used to build these meshes. */
  layout: Layout;
  /** Overall world-space [width, height, depth] including rails (mm). */
  dimensions: number[];
  /** Smallest evaluated nearby-pair gap, capped by a 1 mm search; null if no pairs were tested. */
  minGap: number | null;
  /** Blocking geometry or continuous-removal failures; warnings live in layout. */
  errors: string[];
  /** Total triangle count across all parts. */
  triangles: number;
  /** Elapsed generation and validation time, including cache reuse (milliseconds). */
  durationMs: number;
}
/** Returns only physically present connector edges for a shape. */
export const availableEdges = (kind: PodKind): readonly Edge[] =>
  kind === 'half' ? HALF_EDGES : EDGES;
/** Tests the fixed connector gender; does not depend on a pod or camera pose. */
export const isMale = (edge: Edge) => MALE.includes(edge);
/**
 * Checks supported modes, shapes, numeric ranges and collection values.
 * @param c Candidate configuration, also checked at runtime at external boundaries.
 * @returns User-readable errors; an empty array means these input checks passed.
 * Does not prove mesh validity, sanitize cell keys, or check connector collisions.
 */
export function validateConfig(c: Configuration): string[] {
  const errors: string[] = [];
  if (
    !c ||
    !['single', 'assembly'].includes(c.mode) ||
    !['full', 'half'].includes(c.kind)
  )
    return ['Invalid model configuration.'];
  if (
    !Number.isInteger(c.columns) ||
    c.columns < 1 ||
    c.columns > 20 ||
    !Number.isInteger(c.rows) ||
    c.rows < 1 ||
    c.rows > 20
  )
    errors.push('Use 1–20 columns and rows.');
  for (const [key, min, max] of [
    ['wallGap', 0.2, 0.8],
    ['fit', CALIBRATION_FITS[0], 0.5],
    ['axial', 0.2, 1.0],
  ] as const) {
    const value = c.clearances?.[key];
    if (!Number.isFinite(value) || value < min || value > max)
      errors.push(`${key} must be between ${min} and ${max} mm.`);
  }
  if (!Array.isArray(c.enabled) || c.enabled.some((e) => !EDGES.includes(e)))
    errors.push('Invalid connector edge.');
  if (
    !c.cells ||
    Object.values(c.cells).some((k) => !['full', 'half', 'empty'].includes(k))
  )
    errors.push('Invalid layout cell.');
  if (
    !c.overrides ||
    Object.values(c.overrides).some((v) => typeof v !== 'boolean')
  )
    errors.push('Invalid connection override.');
  return errors;
}

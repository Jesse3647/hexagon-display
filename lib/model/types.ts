export const EDGES = ['NE', 'N', 'NW', 'SW', 'S', 'SE'] as const;
export type Edge = (typeof EDGES)[number];
export type PodKind = 'full' | 'half';
export type CellKind = PodKind | 'empty';
export const MALE: readonly Edge[] = ['N', 'NE', 'SE'];
export const HALF_EDGES: readonly Edge[] = ['NE', 'N', 'NW'];
export const OPPOSITE: Record<Edge, Edge> = {
  N: 'S',
  S: 'N',
  NE: 'SW',
  SW: 'NE',
  NW: 'SE',
  SE: 'NW',
};
export const DIM = {
  height: 34,
  radius: 34 / Math.sqrt(3),
  opening: 30,
  depth: 22.05,
  back: 2.4,
  wall: 2,
  channelDepth: 1.15,
  seam: 3.4,
  far: 5.4,
  stop: 1.6,
  lead: 1,
  tip: 0.12,
} as const;
export interface Clearances {
  wallGap: number;
  fit: number;
  axial: number;
}
export const DEFAULT_CLEARANCES: Clearances = {
  wallGap: 0.3,
  fit: 0.3,
  axial: 0.4,
};
export interface Configuration {
  mode: 'single' | 'assembly';
  kind: PodKind;
  enabled: Edge[];
  clearances: Clearances;
  columns: number;
  rows: number;
  cells: Record<string, CellKind>;
  flatBase: boolean;
  overrides: Record<string, boolean>;
}
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
export interface Pod {
  id: string;
  kind: PodKind;
  x: number;
  y: number;
  baseTrim: number;
  enabled: Edge[];
  filler: boolean;
}
export interface Connection {
  key: string;
  a: string;
  b: string;
  edge: Edge;
  on: boolean;
  male: string;
  female: string;
}
export interface Layout {
  pods: Pod[];
  connections: Connection[];
  groups: string[][];
  order: string[];
  warnings: string[];
}
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}
export interface Part extends Pod {
  mesh: MeshData;
  volume: number;
  bounds: { min: number[]; max: number[] };
}
export interface ModelResult {
  parts: Part[];
  layout: Layout;
  dimensions: number[];
  minGap: number | null;
  errors: string[];
  triangles: number;
  durationMs: number;
}
export const availableEdges = (kind: PodKind): readonly Edge[] =>
  kind === 'half' ? HALF_EDGES : EDGES;
export const isMale = (edge: Edge) => MALE.includes(edge);
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
    ['fit', 0.15, 0.5],
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

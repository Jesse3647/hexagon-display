import Module, {
  type ManifoldToplevel,
  type Manifold,
  type CrossSection,
  type Vec2,
} from 'manifold-3d';
import {
  DIM,
  isMale,
  validateConfig,
  type Clearances,
  type Configuration,
  type MeshData,
  type ModelResult,
  type Pod,
} from './types';
import { makeLayout, normal } from './layout';
/** Cached pod-local geometry. The engine owns the WASM handles and mesh arrays. */
export interface Variant {
  /** One closed pod body; borrow only while the cache entry is live. */
  solid: Manifold;
  /** Continuous +Z removal envelope, including later-starting front-stop material. */
  sweep: Manifold;
  /** Copied JS vertex/index arrays; callers must not mutate or transfer their buffers. */
  mesh: MeshData;
  /** Closed body volume in mm³. */
  volume: number;
  /** Local XYZ bounds in mm, before pod placement. */
  bounds: { min: number[]; max: number[] };
}
/**
 * Manifold-backed printable geometry and collision checks, used by workers and CLI.
 * Reuses pod-local variants across layouts. WASM resources are explicitly owned:
 * temporary objects are deleted, cached objects survive until eviction/dispose.
 */
export class GeometryEngine {
  /** Insertion-ordered LRU cache of at most 160 variants. */
  private cache = new Map<string, Variant>();
  /** Relative-pose checks keyed by both variants, XY offset and first-removing pod. */
  private pairCache = new Map<
    string,
    { gap: number; collision: boolean; blocked: boolean }
  >();
  /** Initialized WASM API, exposed for calibration crops and geometry verification. */
  private constructor(public api: ManifoldToplevel) {}
  /**
   * Loads and initializes one Manifold instance.
   * @param wasmUrl Bundled browser WASM asset URL; omit for the Node package loader.
   * @returns An engine the caller must dispose or terminate with its owning worker.
   */
  static async create(wasmUrl?: string) {
    const api = await Module(
      wasmUrl ? { locateFile: () => wasmUrl } : undefined,
    );
    api.setup();
    return new GeometryEngine(api);
  }
  /** Cache identity excludes placement and selection: only shape, trim, edges and fit affect a solid. */
  key(p: Pod, c: Clearances) {
    return JSON.stringify([p.kind, p.baseTrim, [...p.enabled].sort(), c]);
  }
  /**
   * Gets or builds one local pod with integrated rails and solid disabled walls.
   * @param p Shape, enabled edges and base trim; x/y placement is deliberately ignored.
   * @param c Shared calibration clearances in millimeters.
   * @returns Borrowed cache entry; do not delete its handles or modify its mesh.
   * @throws If construction fails or produces anything other than one positive solid.
   * Handles become invalid after eviction or dispose; copied JS arrays remain alive.
   */
  variant(p: Pod, c: Clearances): Variant {
    const key = this.key(p, c);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const owned: { delete(): void }[] = [];
    /** Registers a temporary WASM handle for reverse-order cleanup, including on failure. */
    const keep = <T extends { delete(): void }>(item: T): T => {
      owned.push(item);
      return item;
    };
    const { CrossSection: CS } = this.api;
    try {
      const r = DIM.radius,
        h = DIM.height / 2,
        t = p.baseTrim;
      const points: Vec2[] =
        p.kind === 'full'
          ? [
              [r, 0],
              [r / 2, h],
              [-r / 2, h],
              [-r, 0],
              [-r / 2, -h],
              [r / 2, -h],
            ]
          : [
              [r - t / Math.sqrt(3), t],
              [r / 2, h],
              [-r / 2, h],
              [-r + t / Math.sqrt(3), t],
            ];
      const outer = keep(new CS(points));
      const inner = keep(outer.offset(-DIM.wall, 'Miter', 3));
      const walls = keep(outer.subtract(inner));
      const back = keep(outer.extrude(DIM.back)),
        wallSolid = keep(walls.extrude(DIM.depth));
      let body = keep(back.add(wallSolid));
      let earliest = outer;
      const channelEnd = DIM.depth - DIM.stop,
        railEnd = channelEnd - c.axial;
      const railProfiles: CrossSection[] = [];
      for (const edge of p.enabled) {
        const [nx, ny] = normal(edge),
          tangent: Vec2 = [ny, -nx];
        // Edge-local x runs along the wall; y runs outward from its face.
        // Rotate that frame into the fixed front-view XY system before extrusion.
        const toWorld = ([x, y]: Vec2): Vec2 => [
          nx * (h + y) + tangent[0] * x,
          ny * (h + y) + tangent[1] * x,
        ];
        if (!isMale(edge)) {
          // Cavity widens inside the wall; its mouth is deliberately open through
          // the outer face. The front stop is the only axial obstruction.
          const section = keep(
            new CS(
              (
                [
                  [-1.7, 0.05],
                  [-2.7, -DIM.channelDepth],
                  [2.7, -DIM.channelDepth],
                  [1.7, 0.05],
                ] as Vec2[]
              ).map(toWorld),
            ),
          );
          const cut = keep(section.extrude(channelEnd + 0.05));
          const shifted = keep(cut.translate([0, 0, -0.05]));
          body = keep(body.subtract(shifted));
          earliest = keep(earliest.subtract(section));
        } else {
          // Offset the sloping flank by the requested NORMAL distance, not just
          // an X offset. Extend the throat across the seam and into its own wall.
          const slope = (DIM.far - DIM.seam) / 2 / DIM.channelDepth;
          const throat = DIM.seam / 2 - c.fit * Math.sqrt(1 + slope * slope);
          const reach = DIM.channelDepth - c.fit,
            tipWidth = throat + slope * reach;
          const local: Vec2[] = [
            [-throat, -0.25],
            [throat, -0.25],
            [throat, c.wallGap],
            [tipWidth, c.wallGap + reach],
            [-tipWidth, c.wallGap + reach],
            [-throat, c.wallGap],
          ];
          const profile = keep(new CS(local.map(toWorld)));
          railProfiles.push(profile);
          const shaft = keep(profile.extrude(railEnd - DIM.lead));
          // Scale about the throat, a point in the polygon's visibility kernel.
          // A convex hull would fill the concave shoulders and bind tighter fits.
          const center: Vec2 = [nx * (h + c.wallGap), ny * (h + c.wallGap)];
          const centered = keep(profile.translate([-center[0], -center[1]]));
          const scale =
            1 - DIM.tip / Math.max(tipWidth, c.wallGap + 0.25, reach);
          const lead = keep(centered.extrude(DIM.lead, 0, 0, [scale, scale]));
          const taper = keep(
            lead.translate([center[0], center[1], railEnd - DIM.lead]),
          );
          const rail = keep(shaft.add(taper));
          body = keep(body.add(rail));
        }
      }
      const status = body.status();
      if (status !== 'NoError') throw new Error(`Geometry failed: ${status}`);
      const pieces = body.decompose();
      const count = pieces.length;
      pieces.forEach((piece) => piece.delete());
      if (count !== 1 || body.volume() <= 0)
        throw new Error('A pod must be one closed solid.');
      // Exact continuous +Z sweep for this construction, for travel >= depth:
      // every non-channel XY column starts at Z=0 (solid back + rail). Filled
      // channel columns first appear at the front stop. Taper only removes
      // material at greater Z. These two extrusions cover every intermediate
      // position, including collisions missed by discrete movement samples.
      let footprint = earliest;
      for (const profile of railProfiles)
        footprint = keep(footprint.add(profile));
      const lowerSweep = keep(footprint.extrude(2 * DIM.depth + 2));
      const cap = keep(outer.extrude(DIM.stop + DIM.depth + 2));
      const capShift = keep(cap.translate([0, 0, channelEnd]));
      const sweep = keep(lowerSweep.add(capShift));
      const raw = body.getMesh();
      const positions = new Float32Array(raw.numVert * 3);
      for (let i = 0; i < raw.numVert; i++)
        for (let k = 0; k < 3; k++)
          positions[i * 3 + k] = raw.vertProperties[i * raw.numProp + k];
      const result: Variant = {
        solid: body,
        sweep,
        mesh: { positions, indices: new Uint32Array(raw.triVerts) },
        volume: body.volume(),
        bounds: body.boundingBox(),
      };
      owned.splice(owned.indexOf(body), 1);
      owned.splice(owned.indexOf(sweep), 1);
      // Bounded persistent WASM memory; returned mesh arrays live in JS memory.
      if (this.cache.size >= 160) {
        const oldest = this.cache.keys().next().value!;
        const previous = this.cache.get(oldest)!;
        previous.solid.delete();
        previous.sweep.delete();
        this.cache.delete(oldest);
        this.pairCache.clear();
      }
      this.cache.set(key, result);
      return result;
    } finally {
      for (let i = owned.length - 1; i >= 0; i--) owned[i].delete();
    }
  }
  /**
   * Builds separate meshes, then tests assembled clearance and every removal pair.
   * @param config Complete single-pod or assembly input.
   * @returns Meshes plus blocking errors; invalid solids/configuration may throw instead.
   * The sweep follows the first pod in layout.order against each stationary partner.
   * Positive modeled gaps are digital evidence, not a physical printer guarantee.
   */
  generate(config: Configuration): ModelResult {
    const start = performance.now();
    const invalid = validateConfig(config);
    if (invalid.length) throw new Error(invalid.join(' '));
    const layout = makeLayout(config);
    const parts = layout.pods.map((p) => {
      const v = this.variant(p, config.clearances);
      return { ...p, mesh: v.mesh, volume: v.volume, bounds: v.bounds };
    });
    const errors: string[] = [];
    let minGap: number | null = null;
    const removal = new Map(layout.order.map((id, i) => [id, i]));
    // Expand local XY bounds by 0.85 mm: the largest supported wall gap (0.8)
    // plus a 0.05 mm margin. Vertical removal cannot approach XY-distant pods.
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i],
          b = parts[j];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const nearby =
          a.bounds.max[0] + 0.85 >= b.bounds.min[0] + dx &&
          b.bounds.max[0] + dx + 0.85 >= a.bounds.min[0] &&
          a.bounds.max[1] + 0.85 >= b.bounds.min[1] + dy &&
          b.bounds.max[1] + dy + 0.85 >= a.bounds.min[1];
        if (!nearby) continue;
        const first = (removal.get(a.id) ?? 0) < (removal.get(b.id) ?? 0);
        const key = JSON.stringify([
          this.key(a, config.clearances),
          this.key(b, config.clearances),
          +dx.toFixed(7),
          +dy.toFixed(7),
          first,
        ]);
        let check = this.pairCache.get(key);
        if (!check) {
          const va = this.variant(a, config.clearances),
            vb = this.variant(b, config.clearances);
          const bs = vb.solid.translate([dx, dy, 0]);
          const overlap = va.solid.intersect(bs);
          const moved = first ? va.sweep : vb.sweep.translate([dx, dy, 0]);
          const stationary = first ? bs : va.solid;
          const collision = moved.intersect(stationary);
          // Ignore numerical dust below 1e-7 mm³ when classifying intersections.
          // The later 1e-4 mm gap check separately rejects touching surfaces.
          check = {
            gap: va.solid.minGap(bs, 1),
            collision: overlap.volume() > 1e-7,
            blocked: collision.volume() > 1e-7,
          };
          overlap.delete();
          collision.delete();
          bs.delete();
          if (!first) moved.delete();
          if (this.pairCache.size > 10000) this.pairCache.clear();
          this.pairCache.set(key, check);
        }
        minGap = Math.min(minGap ?? Infinity, check.gap);
        if (check.collision || check.gap < 0.0001)
          errors.push(`Pods ${a.id} and ${b.id} touch or overlap.`);
        if (check.blocked)
          errors.push(
            `The removal path between ${a.id} and ${b.id} is blocked.`,
          );
      }
    if (!parts.length) errors.push('Add at least one pod before exporting.');
    const min = [Infinity, Infinity, 0],
      max = [-Infinity, -Infinity, 0];
    for (const p of parts)
      for (let k = 0; k < 3; k++) {
        const offset = k === 0 ? p.x : k === 1 ? p.y : 0;
        min[k] = Math.min(min[k], p.bounds.min[k] + offset);
        max[k] = Math.max(max[k], p.bounds.max[k] + offset);
      }
    return {
      parts,
      layout,
      dimensions: parts.length ? max.map((v, k) => v - min[k]) : [0, 0, 0],
      minGap,
      errors: [...new Set(errors)],
      triangles: parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0),
      durationMs: performance.now() - start,
    };
  }
  /** Deletes cached WASM bodies and sweeps. Safe to call again after the caches are empty. */
  dispose() {
    for (const v of this.cache.values()) {
      v.solid.delete();
      v.sweep.delete();
    }
    this.cache.clear();
    this.pairCache.clear();
  }
}

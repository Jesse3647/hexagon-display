import { zipSync, strToU8 } from 'fflate';
import {
  DIM,
  initialConfig,
  type Clearances,
  type Configuration,
  type MeshData,
  type ModelResult,
  type Part,
} from './types';
import { GeometryEngine } from './geometry';
import { exportSTL, export3MF } from './export';
/**
 * Crops a validated north/south pod joint into two small full-depth fit strips.
 * @param engine Shared engine; borrowed variants are not deleted by this function.
 * @param clearances Wall, connector and front-stop spacings to test (mm).
 * @param separate True offsets the second strip by 20 mm in X; false keeps them interlocked.
 * @returns Export-compatible sample config/result with cropped mesh coordinates baked in.
 * Inherited gap/timing fields describe the source pair, not a new crop validation pass.
 * @throws If the source pair is invalid or cropping fails to produce material.
 */
export function makeCalibration(
  engine: GeometryEngine,
  clearances: Clearances,
  separate: boolean,
): { config: Configuration; result: ModelResult } {
  const config = {
    ...initialConfig(),
    mode: 'assembly' as const,
    columns: 1,
    rows: 2,
    clearances,
  };
  const original = engine.generate(config);
  if (original.errors.length) throw new Error(original.errors.join(' '));
  // Keep only the shared horizontal edge around Y=17, including the back,
  // full rail depth and front stop. A shallow coupon would miss axial binding.
  const baseBox = engine.api.Manifold.cube([
    14,
    8 + clearances.wallGap,
    DIM.depth + 2,
  ]);
  const crop = baseBox.translate([-7, 13, -1]);
  baseBox.delete();
  const parts: Part[] = [];
  try {
    original.parts.forEach((p, i) => {
      const v = engine.variant(p, clearances),
        placed = v.solid.translate([p.x, p.y, 0]);
      const cut = placed.intersect(crop);
      placed.delete();
      const moved = cut.translate([7 + (separate ? i * 20 : 0), -13, 0]);
      cut.delete();
      if (moved.status() !== 'NoError' || moved.volume() <= 0)
        throw new Error('Calibration sample could not be generated.');
      const raw = moved.getMesh(),
        positions = new Float32Array(raw.numVert * 3);
      for (let v = 0; v < raw.numVert; v++)
        for (let k = 0; k < 3; k++)
          positions[v * 3 + k] = raw.vertProperties[v * raw.numProp + k];
      const mesh: MeshData = {
        positions,
        indices: new Uint32Array(raw.triVerts),
      };
      // The crop translation is already baked into these vertices, so reset
      // placement to zero to avoid applying the original pod offset a second time.
      parts.push({
        ...p,
        x: 0,
        y: 0,
        id: `${i === 0 ? 'male' : 'female'}-fit-${clearances.fit.toFixed(2)}`,
        mesh,
        volume: moved.volume(),
        bounds: moved.boundingBox(),
      });
      moved.delete();
    });
  } finally {
    crop.delete();
  }
  const layout = {
    ...original.layout,
    pods: parts,
    groups: [parts.map((p) => p.id)],
    connections: [],
    order: [parts[1].id, parts[0].id],
    warnings: [],
  };
  return {
    config,
    result: {
      ...original,
      parts,
      layout,
      dimensions: [separate ? 34 : 14, 8 + clearances.wallGap, DIM.depth],
      triangles: parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0),
    },
  };
}
/**
 * Builds labeled STL/3MF samples at fit clearances 0.20, 0.30 and 0.40 mm.
 * @param engine Geometry cache shared across the three samples.
 * @param config Supplies wallGap and axial clearance; its fit value is replaced per sample.
 * @param separate Selects separately printed strips or pre-interlocked strips.
 * @returns ZIP bytes including printing instructions; performs no download itself.
 */
export function calibrationZip(
  engine: GeometryEngine,
  config: Configuration,
  separate: boolean,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const fit of [0.2, 0.3, 0.4]) {
    const sample = makeCalibration(
      engine,
      { ...config.clearances, fit },
      separate,
    );
    const name = `${separate ? 'separate-fit' : 'print-in-place'}-${fit.toFixed(2)}mm`;
    files[`${name}.stl`] = exportSTL(sample.result);
    files[`${name}.3mf`] = export3MF(sample.result, sample.config);
  }
  files['READ-ME.txt'] = strToU8(
    `HONEYCOMB CONNECTOR CALIBRATION\n\nThe filename identifies connector clearance per mating surface: 0.20, 0.30, or 0.40 mm. Print one labeled file at a time to keep samples identified.\n\nWall gap: ${config.clearances.wallGap.toFixed(2)} mm. Front-stop clearance: ${config.clearances.axial.toFixed(2)} mm.\n\nUse the printer, material, nozzle and layer profile intended for your display. Print flat backs on the bed, all layers together, supports OFF. Preserve all component positions. Do not use automatic gap closing or merge separate bodies. Compensate elephant foot as appropriate for your calibrated slicer profile.\n\n${separate ? 'The two strips are separated on the bed. Slide the female strip over the tapered end of the male rail until their fronts align.' : 'These two strips print already interlocked. After cooling, slide the female strip toward the open front (+Z) to release it; slide back to reassemble.'}\n\nChoose the smallest clearance that releases and slides comfortably without tools. Do not force a binding joint. Repeat assembly several times and check for cracking or excessive looseness. Apply the chosen settings to BOTH single pods and assemblies.\n\nThese are geometry-validated starting points, not a claim of physical validation on your printer. STL uses millimeters; 3MF preserves the separate parts and positions.\n`,
  );
  return zipSync(files, { level: 6 });
}

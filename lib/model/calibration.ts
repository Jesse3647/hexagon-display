import { zipSync, strToU8 } from 'fflate';
import {
  CONNECTOR_SYSTEM,
  CALIBRATION_FITS,
  CALIBRATION_HEIGHT,
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
 * Crops a validated short north/south joint into two 8 mm tall fit strips.
 * Only straight rail length is shortened; XY fit, back, square rail end and stop match the full pod.
 * @param engine Shared engine; borrowed variants are not deleted by this function.
 * @param clearances Wall, connector and front-stop spacings to test (mm).
 * @returns Assembled source coupons with cropped coordinates baked in. Both exporters
 * space these bodies apart on the bed; source geometry keeps the original mating pose.
 * Inherited gap/timing fields describe the shortened source pair, not the full-depth pods.
 * @throws If the source pair is invalid or cropping fails to produce material.
 */
export function makeCalibration(
  engine: GeometryEngine,
  clearances: Clearances,
): { config: Configuration; result: ModelResult } {
  const config = {
    ...initialConfig(),
    mode: 'assembly' as const,
    columns: 1,
    rows: 2,
    clearances,
  };
  const original = engine.generate(config, CALIBRATION_HEIGHT);
  if (original.errors.length) throw new Error(original.errors.join(' '));
  // Build the shorter joint before cropping XY; simply chopping a full pod
  // at Z=8 would discard the rail end and front stop that calibration must test.
  const baseBox = engine.api.Manifold.cube([
    14,
    8 + clearances.wallGap,
    CALIBRATION_HEIGHT + 2,
  ]);
  const crop = baseBox.translate([-7, 13, -1]);
  baseBox.delete();
  const parts: Part[] = [];
  try {
    original.parts.forEach((p, i) => {
      const v = engine.variant(p, clearances, CALIBRATION_HEIGHT),
        placed = v.solid.translate([p.x, p.y, 0]);
      const cut = placed.intersect(crop);
      placed.delete();
      const moved = cut.translate([7, -13, 0]);
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
      dimensions: [14, 8 + clearances.wallGap, CALIBRATION_HEIGHT],
      triangles: parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0),
    },
  };
}
/**
 * Builds labeled STL/3MF samples at fit clearances 0.10, 0.15 and 0.20 mm.
 * @param engine Geometry cache shared across the three samples.
 * @param config Supplies wallGap and axial clearance; its fit value is replaced per sample.
 * @returns ZIP bytes including printing instructions; performs no download itself.
 */
export function calibrationZip(
  engine: GeometryEngine,
  config: Configuration,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const fit of CALIBRATION_FITS) {
    const sample = makeCalibration(engine, { ...config.clearances, fit });
    const name = `${CONNECTOR_SYSTEM}-separate-fit-${CALIBRATION_HEIGHT}mm-tall-square-base-fit-${fit.toFixed(2)}mm`;
    files[`${name}.stl`] = exportSTL(sample.result);
    files[`${name}.3mf`] = export3MF(sample.result, sample.config);
  }
  files['READ-ME.txt'] = strToU8(
    `HONEYCOMB T-SLOT V2 CALIBRATION\n\nHeight above the bed: ${CALIBRATION_HEIGHT} mm. Square bed edges: full female lips and backing start at Z=0, with no bottom bevel or rail-tip taper. The straight rail is shortened; connector cross-section, back thickness, square rail end and front stop match the pods. This is a quick assembly/fit check, not a test of full-length sliding friction.\n\nThe filename identifies connector clearance per mating surface: ${CALIBRATION_FITS.map((fit) => fit.toFixed(2)).join(', ')} mm. Print one labeled file at a time to keep samples identified.\n\nWall gap: ${config.clearances.wallGap.toFixed(2)} mm. Front-stop clearance: ${config.clearances.axial.toFixed(2)} mm.\n\nUse the printer, material, nozzle and layer profile intended for your display. Print flat backs on the bed, all layers together, supports OFF. Preserve all component positions. Do not use automatic gap closing or merge separate bodies. Compensate elephant foot as appropriate for your calibrated slicer profile.\n\nThe two strips print 5 mm apart. After cooling, slide the female strip over the square end of the male rail until their fronts align.\n\nThese are sliding T-slot v2 joints using the original 2 mm walls, with 0.55 mm lips and a thicker head. Print BOTH parts from this revision; do not mix them with v1 T-slots or earlier dovetails. Classic and Arachne have been digitally checked with a 0.4 mm nozzle, 0.20 mm layers, 0.42 mm outer and 0.45 mm inner walls. No thin-wall detection is required in that reference profile. Check that your sliced lips, head and backing remain continuous; other nozzle/line widths need their own check. Start with the separate-fit 0.15 mm pair. Assemble after cooling and check sideways retention while fully engaged. There is no snap latch. Print-in-place is no longer the supported workflow.\n\nChoose the smallest clearance that releases and slides comfortably without tools. Do not force a binding joint. Repeat assembly several times and check for cracking or excessive looseness. Apply the chosen settings to BOTH single pods and assemblies.\n\nThese are geometry-validated starting points, not a claim of physical validation on your printer. STL uses millimeters; 3MF preserves the separate parts and positions.\n`,
  );
  return zipSync(files, { level: 6 });
}

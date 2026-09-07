/**
 * Generate representative STL/3MF pairs, three-fit calibration ZIPs and a report.
 * Run from the repository root: pnpm validate:models [optional-output-directory].
 * The default is ./generated; matching files are overwritten. This runs digital
 * geometry checks only. Bambu slicing and independent round trips are separate scripts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GeometryEngine } from '../lib/model/geometry';
import { initialConfig, EDGES, type Configuration } from '../lib/model/types';
import { exportSTL, export3MF } from '../lib/model/export';
import { calibrationZip, makeCalibration } from '../lib/model/calibration';
const destination = resolve(process.argv[2] ?? 'generated');
await mkdir(destination, { recursive: true });
const engine = await GeometryEngine.create();
const report: Record<string, unknown> = {
  units: 'millimeters',
  physicalValidation:
    'Not performed. Print calibration samples on your intended printer and material.',
  models: {},
};
try {
  // Include the closed/full/half extremes and two layouts that exercise fillers,
  // holes and half substitutions. Exhaustive connector masks belong in the tests.
  const cases: Record<string, Configuration> = {
    closed_pod: initialConfig(),
    all_connectors: { ...initialConfig(), enabled: [...EDGES] },
    half_pod: { ...initialConfig(), kind: 'half', enabled: ['N', 'NE', 'NW'] },
    assembly_3x3: { ...initialConfig(), mode: 'assembly', flatBase: true },
    edited_assembly: {
      ...initialConfig(),
      mode: 'assembly',
      cells: { '1,1': 'empty', '0,0': 'half' },
    },
  };
  for (const [name, config] of Object.entries(cases)) {
    const result = engine.generate(config);
    if (result.errors.length) throw new Error(result.errors.join(' '));
    await writeFile(resolve(destination, `${name}.stl`), exportSTL(result));
    await writeFile(
      resolve(destination, `${name}.3mf`),
      export3MF(result, config),
    );
    (report.models as Record<string, unknown>)[name] = {
      bodies: result.parts.length,
      triangles: result.triangles,
      dimensions: result.dimensions,
      minGap: result.minGap,
      removalOrder: result.layout.order,
      errors: result.errors,
    };
  }
  // Save individual calibration files as well as ZIPs so the slicer verifier
  // can inspect every clearance without parsing archive instructions.
  for (const separate of [false, true]) {
    await writeFile(
      resolve(
        destination,
        `${separate ? 'separate' : 'in-place'}_calibration.zip`,
      ),
      calibrationZip(engine, initialConfig(), separate),
    );
    for (const fit of [0.2, 0.3, 0.4]) {
      const { config, result } = makeCalibration(
        engine,
        { wallGap: 0.3, fit, axial: 0.4 },
        separate,
      );
      const name = `calibration_${separate ? 'separate' : 'in_place'}_${fit.toFixed(2)}`;
      await writeFile(resolve(destination, `${name}.stl`), exportSTL(result));
      await writeFile(
        resolve(destination, `${name}.3mf`),
        export3MF(result, config),
      );
    }
  }
  await writeFile(
    resolve(destination, 'geometry_report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`Generated validated models in ${destination}`);
} finally {
  engine.dispose();
}

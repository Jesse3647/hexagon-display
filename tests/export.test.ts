/**
 * Round-trip/export contract tests using real generated meshes. STL is read by
 * Three.js; 3MF package structure, transforms and indices are independently inspected.
 * These checks do not replace importing/slicing files in a target slicer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GeometryEngine } from '../lib/model/geometry';
import { exportSTL, export3MF } from '../lib/model/export';
import { spacePartsForPrinting } from '../lib/model/print-layout';
import { initialConfig, type Configuration } from '../lib/model/types';
import { makeCalibration, calibrationZip } from '../lib/model/calibration';
const engine = await GeometryEngine.create();
test.after(() => engine.dispose());
void test('STL round trip preserves meshes and orientation with export-only spacing', () => {
  for (const config of [
    initialConfig(),
    { ...initialConfig(), mode: 'assembly' as const, flatBase: true },
  ]) {
    const r = engine.generate(config),
      bytes = exportSTL(r),
      geometry = new STLLoader().parse(bytes.buffer as ArrayBuffer);
    assert.equal(geometry.attributes.position.count, r.triangles * 3);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const dims = [
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    ];
    const posed = spacePartsForPrinting(r.parts);
    const expected = [0, 1, 2].map((axis) => {
      const offset = (p: (typeof posed)[number]) =>
        axis === 0 ? p.x : axis === 1 ? p.y : 0;
      return (
        Math.max(...posed.map((p) => p.bounds.max[axis] + offset(p))) -
        Math.min(...posed.map((p) => p.bounds.min[axis] + offset(p)))
      );
    });
    dims.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-4));
    assert.equal(bounds.min.z, 0);
    geometry.dispose();
  }
});
void test('3MF has separate meshes, millimeter units, valid indices and parent transforms', () => {
  const config: Configuration = { ...initialConfig(), mode: 'assembly' as const },
    r = engine.generate(config),
    files = unzipSync(export3MF(r, config));
  assert.ok(files['[Content_Types].xml']);
  assert.ok(files['_rels/.rels']);
  const text = strFromU8(files['3D/3dmodel.model']);
  assert.match(text, /unit="millimeter"/);
  assert.equal((text.match(/<mesh>/g) ?? []).length, r.parts.length);
  assert.equal((text.match(/<component /g) ?? []).length, r.parts.length);
  assert.equal((text.match(/<item /g) ?? []).length, 1);
  const printParts = spacePartsForPrinting(r.parts);
  const meshes = [
    ...text.matchAll(
      /<object id="(\d+)"[^>]*><mesh><vertices>(.*?)<\/vertices><triangles>(.*?)<\/triangles><\/mesh><\/object>/g,
    ),
  ];
  for (let i = 0; i < meshes.length; i++) {
    const vertices = [
      ...meshes[i][2].matchAll(
        /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g,
      ),
    ].map((m) => m.slice(1).map(Number));
    assert.equal(vertices.length, r.parts[i].mesh.positions.length / 3);
    const triangles = [
      ...meshes[i][3].matchAll(
        /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g,
      ),
    ].map((m) => m.slice(1).map(Number));
    assert.ok(triangles.flat().every((n) => n < vertices.length));
    assert.deepEqual(triangles.flat(), Array.from(r.parts[i].mesh.indices));
    assert.match(
      text,
      new RegExp(
        `transform="1 0 0 0 1 0 0 0 1 ${printParts[i].x} ${printParts[i].y} 0"`,
      ),
    );
  }
  assert.equal(
    JSON.parse(strFromU8(files['Metadata/honeycomb.json'])).connectorSystem,
    't-slot-v2',
  );
  assert.deepEqual(
    JSON.parse(strFromU8(files['Metadata/honeycomb.json'])).assemblyPositions,
    r.parts.map(({ id, x, y }) => ({ id, x, y, z: 0 })),
  );
  assert.deepEqual(
    JSON.parse(strFromU8(files['Metadata/honeycomb.json'])).config,
    config,
  );
});
void test('export rejects invalid geometry and can select a disconnected group', () => {
  const config: Configuration = {
      ...initialConfig(),
      mode: 'assembly' as const,
      columns: 1,
      rows: 2,
      overrides: { '0,0|0,1': false },
    },
    r = engine.generate(config);
  assert.equal(r.layout.groups.length, 2);
  const one = unzipSync(export3MF(r, config, 0));
  assert.equal(
    (strFromU8(one['3D/3dmodel.model']).match(/<mesh>/g) ?? []).length,
    1,
  );
  assert.throws(() => exportSTL({ ...r, errors: ['Interference'] }));
  assert.throws(() => exportSTL(r, 5));
});
void test('calibration archives contain three spaced pairs and separate-fit instructions', () => {
  const files = unzipSync(calibrationZip(engine, initialConfig()));
  assert.equal(Object.keys(files).length, 7);
  assert.match(strFromU8(files['READ-ME.txt']), /two strips print 5 mm apart/);
  for (const fit of [0.1, 0.15, 0.2]) {
    const stem = `t-slot-v2-separate-fit-8mm-tall-square-base-fit-${fit.toFixed(2)}mm`;
    assert.ok(files[`${stem}.stl`]);
    const sample = unzipSync(files[`${stem}.3mf`]);
    const meta = JSON.parse(strFromU8(sample['Metadata/honeycomb.json']));
    assert.equal(meta.config.clearances.fit, fit);
    assert.equal(meta.bedRelief, null);
    assert.equal(meta.railEnd, 'square');
    assert.deepEqual(meta.printLayout, {
      mode: 'separated',
      minimumPartGapMm: 5,
    });
    const { result } = makeCalibration(engine, {
      wallGap: 0.3,
      fit,
      axial: 0.4,
    });
    assert.equal(result.parts.length, 2);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.dimensions, [14, 8.3, 8]);
    const printParts = spacePartsForPrinting(result.parts);
    assertSeparated(printParts);
    for (const p of printParts) {
      assert.equal(p.bounds.min[2], 0);
      assert.equal(p.bounds.max[2], 8);
    }
  }
});

/** Independent bounds check: each pair must have a 5 mm lane along X or Y. */
function assertSeparated(parts: ReturnType<typeof spacePartsForPrinting>) {
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j];
      const gapX = Math.max(
        b.bounds.min[0] + b.x - a.bounds.max[0] - a.x,
        a.bounds.min[0] + a.x - b.bounds.max[0] - b.x,
      );
      const gapY = Math.max(
        b.bounds.min[1] + b.y - a.bounds.max[1] - a.y,
        a.bounds.min[1] + a.y - b.bounds.max[1] - b.y,
      );
      assert.ok(
        Math.max(gapX, gapY) >= 5 - 1e-6,
        `${a.id} and ${b.id} are too close`,
      );
    }
}

void test('spaced exports preserve the assembled preview, group selection and every mesh', () => {
  for (const [columns, rows] of [
    [1, 4],
    [4, 1],
    [3, 3],
    [4, 3],
    [20, 20],
  ]) {
    const config: Configuration = {
      ...initialConfig(),
      mode: 'assembly' as const,
      columns,
      rows,
      flatBase: true,
      cells:
        columns > 1 && rows > 1
          ? { '1,1': 'empty' as const, '0,0': 'half' as const }
          : {},
    };
    const result = engine.generate(config);
    const before = structuredClone(result);
    const printParts = spacePartsForPrinting(result.parts);
    assertSeparated(printParts);
    printParts.forEach((part, i) => {
      assert.strictEqual(part.mesh, result.parts[i].mesh);
      assert.deepEqual(part.enabled, result.parts[i].enabled);
      assert.equal(part.bounds.min[2], 0);
    });
    exportSTL(result);
    export3MF(result, config);
    assert.deepEqual(
      result,
      before,
      'export must never move the preview or mutate its mesh buffers',
    );
  }
  const config: Configuration = {
    ...initialConfig(),
    mode: 'assembly' as const,
    columns: 1,
    rows: 4,
    cells: { '0,2': 'empty' as const },
  };
  const result = engine.generate(config);
  const archive = unzipSync(export3MF(result, config, 0));
  const metadata = JSON.parse(strFromU8(archive['Metadata/honeycomb.json']));
  assert.deepEqual(
    metadata.assemblyPositions.map((p: { id: string }) => p.id),
    result.layout.groups[0],
  );
  assert.equal(
    (strFromU8(archive['3D/3dmodel.model']).match(/<mesh>/g) ?? []).length,
    2,
  );
});

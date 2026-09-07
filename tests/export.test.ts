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
import { initialConfig } from '../lib/model/types';
import { makeCalibration, calibrationZip } from '../lib/model/calibration';
const engine = await GeometryEngine.create();
test.after(() => engine.dispose());
void test('STL round trip preserves triangles, dimensions and print orientation', () => {
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
    dims.forEach((v, i) => assert.ok(Math.abs(v - r.dimensions[i]) < 1e-4));
    assert.equal(bounds.min.z, 0);
    geometry.dispose();
  }
});
void test('3MF has separate meshes, millimeter units, valid indices and parent transforms', () => {
  const config = { ...initialConfig(), mode: 'assembly' as const },
    r = engine.generate(config),
    files = unzipSync(export3MF(r, config));
  assert.ok(files['[Content_Types].xml']);
  assert.ok(files['_rels/.rels']);
  const text = strFromU8(files['3D/3dmodel.model']);
  assert.match(text, /unit="millimeter"/);
  assert.equal((text.match(/<mesh>/g) ?? []).length, r.parts.length);
  assert.equal((text.match(/<component /g) ?? []).length, r.parts.length);
  assert.equal((text.match(/<item /g) ?? []).length, 1);
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
        `transform="1 0 0 0 1 0 0 0 1 ${r.parts[i].x} ${r.parts[i].y} 0"`,
      ),
    );
  }
  assert.deepEqual(
    JSON.parse(strFromU8(files['Metadata/honeycomb.json'])).config,
    config,
  );
});
void test('export rejects invalid geometry and can select a disconnected group', () => {
  const config = {
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
void test('calibration archives include three fits in both formats and separate solids', () => {
  for (const separate of [false, true]) {
    const files = unzipSync(calibrationZip(engine, initialConfig(), separate));
    assert.equal(Object.keys(files).length, 7);
    assert.ok(files['READ-ME.txt']);
    for (const fit of [0.2, 0.3, 0.4]) {
      const { result } = makeCalibration(
        engine,
        { wallGap: 0.3, fit, axial: 0.4 },
        separate,
      );
      assert.equal(result.parts.length, 2);
      assert.deepEqual(result.errors, []);
      for (const p of result.parts) assert.equal(p.bounds.min[2], 0);
    }
  }
});

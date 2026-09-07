import test from 'node:test';
import assert from 'node:assert/strict';
import { GeometryEngine } from '../lib/model/geometry';
import {
  EDGES,
  HALF_EDGES,
  DIM,
  initialConfig,
  type Pod,
  type Configuration,
} from '../lib/model/types';
import { makeLayout, toggleEdge } from '../lib/model/layout';
const engine = await GeometryEngine.create();
test.after(() => engine.dispose());
void test('all 64 full and 8 half combinations form one oriented closed solid', () => {
  for (const kind of ['full', 'half'] as const) {
    const edges = kind === 'full' ? EDGES : HALF_EDGES;
    for (let bits = 0; bits < 2 ** edges.length; bits++) {
      const p: Pod = {
        id: 'test',
        kind,
        x: 0,
        y: 0,
        baseTrim: 0,
        filler: false,
        enabled: edges.filter((_, i) => bits & (1 << i)),
      };
      const v = engine.variant(p, initialConfig().clearances);
      assert.equal(v.solid.status(), 'NoError');
      assert.ok(v.volume > 0);
      const edgeMap = new Map<string, number>();
      const f = v.mesh.indices;
      for (let j = 0; j < f.length; j += 3)
        for (let k = 0; k < 3; k++) {
          const a = f[j + k],
            b = f[j + ((k + 1) % 3)];
          const key = [Math.min(a, b), Math.max(a, b)].join(',');
          edgeMap.set(key, (edgeMap.get(key) ?? 0) + (a < b ? 1 : -1));
        }
      assert.ok(
        [...edgeMap.values()].every((n) => n === 0),
        `${kind} mask ${bits} is consistently closed`,
      );
    }
  }
});
void test('unconnected pod preserves opening, exterior and solid wall dimensions', () => {
  const c = initialConfig(),
    r = engine.generate(c);
  assert.deepEqual(r.errors, []);
  for (const [a, b] of r.dimensions.map((n, i) => [
    n,
    [2 * DIM.radius, 34, 22.05][i],
  ]))
    assert.ok(Math.abs(a - b) < 1e-5);
  const p = r.parts[0],
    v = engine.variant(p, c.clearances);
  const section = v.solid.slice(10),
    inner = engine.api.CrossSection.square([2, 2], true);
  const center = section.intersect(inner);
  assert.equal(center.area(), 0);
  section.delete();
  inner.delete();
  center.delete();
});
void test('three directions, multiple fits, and half substitutions have clearance and continuous removal', () => {
  for (const fit of [0.15, 0.3, 0.5])
    for (const kind of ['full', 'half'] as const) {
      const c = {
        ...initialConfig(),
        mode: 'assembly' as const,
        columns: 2,
        rows: 2,
        cells: { '0,0': kind },
        clearances: { wallGap: 0.3, fit, axial: 0.4 },
      };
      const r = engine.generate(c);
      assert.deepEqual(r.errors, [], JSON.stringify(c));
      assert.ok(r.minGap! > 0.1);
      assert.equal(r.layout.order.length, 4);
    }
});
void test('sweep catches front-stop interference for moving male first', () => {
  const c = {
    ...initialConfig(),
    mode: 'assembly' as const,
    columns: 1,
    rows: 2,
  };
  const l = makeLayout(c);
  const a = engine.variant(l.pods[0], c.clearances),
    b = engine.variant(l.pods[1], c.clearances);
  const bs = b.solid.translate([0, 34.3, 0]);
  const obstruction = a.sweep.intersect(bs);
  assert.ok(obstruction.volume() > 0.1);
  obstruction.delete();
  bs.delete();
});
void test('disabled edges restore continuous wall material', () => {
  const c = initialConfig();
  const p = engine.generate(c).parts[0];
  const solid = engine.variant(p, c.clearances);
  const female = engine.variant({ ...p, enabled: ['S'] }, c.clearances);
  assert.ok(solid.volume > female.volume);
  const section = solid.solid.slice(10);
  const sample = engine.api.CrossSection.square([1, 0.8], true).translate([
    0, -16.5,
  ]);
  const filled = section.intersect(sample);
  assert.ok(Math.abs(filled.area() - 0.8) < 1e-4);
  section.delete();
  sample.delete();
  filled.delete();
});
void test('flat fillers share bottom plane and do not interfere', () => {
  for (const columns of [2, 3, 4]) {
    const c = {
      ...initialConfig(),
      mode: 'assembly' as const,
      columns,
      rows: 2,
      flatBase: true,
    };
    const r = engine.generate(c);
    assert.deepEqual(r.errors, []);
    const bottoms = new Map<number, number>();
    for (const p of r.parts)
      bottoms.set(
        p.x,
        Math.min(bottoms.get(p.x) ?? Infinity, p.y + p.bounds.min[1]),
      );
    assert.ok([...bottoms.values()].every((y) => Math.abs(y + 17) < 1e-5));
  }
});
void test('paired overrides, holes, half replacements and disconnected groups', () => {
  let c: Configuration = {
    ...initialConfig(),
    mode: 'assembly',
    columns: 1,
    rows: 2,
  };
  c = toggleEdge(c, '0,0', 'N', false);
  const r = engine.generate(c);
  assert.equal(r.layout.groups.length, 2);
  assert.equal(r.layout.pods[1].enabled.length, 0);
  assert.deepEqual(r.errors, []);
  const edited = {
    ...initialConfig(),
    mode: 'assembly' as const,
    cells: { '1,1': 'empty' as const, '0,0': 'half' as const },
  };
  assert.deepEqual(engine.generate(edited).errors, []);
});
void test('empty and invalid layouts cannot export; singleton row/columns and maximum layout work', () => {
  assert.ok(
    engine.generate({
      ...initialConfig(),
      mode: 'assembly',
      columns: 1,
      rows: 1,
      cells: { '0,0': 'empty' },
    }).errors.length,
  );
  assert.throws(() =>
    engine.generate({
      ...initialConfig(),
      clearances: { wallGap: 0, fit: 0.3, axial: 0.4 },
    }),
  );
  for (const [columns, rows] of [
    [1, 1],
    [1, 5],
    [5, 1],
    [20, 20],
  ]) {
    const r = engine.generate({
      ...initialConfig(),
      mode: 'assembly',
      columns,
      rows,
    });
    assert.deepEqual(r.errors, []);
    assert.equal(r.parts.length, columns * rows);
  }
});

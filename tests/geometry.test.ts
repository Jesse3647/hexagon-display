/**
 * Real-Manifold regression checks for printable bodies and continuous removal.
 * One shared engine is disposed after the suite. Each temporary WASM result is
 * deleted at its point of use; cached variants remain owned by the engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GeometryEngine } from '../lib/model/geometry';
import {
  EDGES,
  HALF_EDGES,
  CALIBRATION_FITS,
  DIM,
  initialConfig,
  type Pod,
  type Configuration,
} from '../lib/model/types';
import { makeLayout, toggleEdge } from '../lib/model/layout';
const engine = await GeometryEngine.create();
test.after(() => engine.dispose());
void test('all 64 full and 8 half combinations form one oriented closed solid', () => {
  for (const fit of [0.1, 0.15, 0.2])
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
        const v = engine.variant(p, { ...initialConfig().clearances, fit });
        assert.equal(v.solid.status(), 'NoError');
        assert.ok(v.volume > 0);
        // Each undirected edge must appear with balanced opposing orientations.
        // Paired with Manifold status and positive volume, this catches winding regressions.
        const edgeMap = new Map<string, number>();
        const f = v.mesh.indices;
        // Boolean topology can be closed in double precision yet collapse on
        // export. Test triangle areas using the actual Float32 mesh vertices.
        for (let j = 0; j < f.length; j += 3) {
          const coords = [0, 1, 2].map((k) =>
            Array.from(v.mesh.positions.slice(f[j + k] * 3, f[j + k] * 3 + 3)),
          );
          const u = coords[1].map((n, k) => n - coords[0][k]);
          const w = coords[2].map((n, k) => n - coords[0][k]);
          const area2 = Math.hypot(
            u[1] * w[2] - u[2] * w[1],
            u[2] * w[0] - u[0] * w[2],
            u[0] * w[1] - u[1] * w[0],
          );
          assert.ok(
            area2 > 1e-10,
            `${kind} mask ${bits} has a collapsed export triangle`,
          );
        }
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
  for (const fit of [0.1, 0.15, 0.2])
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
      assert.ok(r.minGap! > Math.min(0.1, fit / 2));
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

void test('T-slot v2 retains printable lips, backing and head in 2 mm walls at every fit', () => {
  const config = {
    ...initialConfig(),
    mode: 'assembly' as const,
    columns: 1,
    rows: 2,
  };
  const layout = makeLayout(config);
  for (const fit of CALIBRATION_FITS) {
    const clearances = { ...config.clearances, fit };
    const male = engine.variant(layout.pods[0], clearances).solid;
    const femaleLocal = engine.variant(layout.pods[1], clearances).solid;
    const female = femaleLocal.translate([0, 34.3, 0]);
    // Independent material prisms cover the full lip/backing thickness and
    // untapered head (0.70 / 0.60 / 0.50 mm), away from caps and stops.
    for (const [body, center, thickness] of [
      [female, [1.9, 17.575, 10], 0.55],
      [female, [0, 19.025, 10], 0.55],
      [male, [2.5, 18.3, 10], 0.9 - 2 * fit],
    ] as const) {
      const box = engine.api.Manifold.cube([0.1, thickness, 0.1]);
      const witness = box.translate([
        center[0] - 0.05,
        center[1] - thickness / 2,
        center[2] - 0.05,
      ]);
      const missing = witness.subtract(body);
      assert.ok(missing.volume() < 1e-8);
      missing.delete();
      witness.delete();
      box.delete();
    }
    const pulled = female.translate([0, 0.3, 0]);
    const obstruction = pulled.intersect(male);
    assert.ok(
      obstruction.volume() > 1,
      'square shoulders must block sideways extraction',
    );
    obstruction.delete();
    pulled.delete();
    female.delete();
  }
  for (const fit of [0.05, 0.25, 0.5])
    assert.throws(() =>
      engine.generate({ ...config, clearances: { ...config.clearances, fit } }),
    );
});

void test('square-ended rails preserve release and stops in short calibration and full pods', () => {
  const c = {
    ...initialConfig(),
    mode: 'assembly' as const,
    columns: 1,
    rows: 2,
  };
  for (const fit of [0.1, 0.15, 0.2]) {
    c.clearances = { ...c.clearances, fit };
    const short = engine.generate(c, 8);
    assert.deepEqual(short.errors, []);
    assert.ok(short.minGap! > 0.09);
    assert.equal(short.dimensions[2], 8);
    assert.equal(engine.generate(c).dimensions[2], 22.05);
    const [a, b] = makeLayout(c).pods;
    const male = engine.variant(a, c.clearances, 8);
    const female = engine.variant(b, c.clearances, 8);
    const placed = female.solid.translate([b.x, b.y, 0]);
    // Removal in the wrong direction still encounters the preserved front stop.
    const obstruction = male.sweep.intersect(placed);
    assert.ok(obstruction.volume() > 0.1);
    obstruction.delete();
    placed.delete();
    // Compare the actual cross-section just before the end against the shaft,
    // for both coupon and full depth. A taper would leave missing T-head material.
    for (const depth of [8, DIM.depth]) {
      const solid = engine.variant(a, c.clearances, depth).solid;
      const railEnd = depth - DIM.stop - c.clearances.axial;
      const shaft = solid.slice(DIM.back + 0.1);
      const end = solid.slice(railEnd - 0.01);
      const beyond = solid.slice(railEnd + 0.01);
      const missing = shaft.subtract(end);
      const extra = end.subtract(shaft);
      // Slices of simplified triangle faces differ by sub-micrometer rounding.
      assert.ok(
        missing.area() < 1e-6 && extra.area() < 1e-6,
        `fit=${fit}, depth=${depth}: missing=${missing.area()}, extra=${extra.area()}`,
      );
      assert.ok(end.area() > beyond.area(), 'rail must end before the front stop');
      missing.delete();
      extra.delete();
      shaft.delete();
      end.delete();
      beyond.delete();
    }
    const channel = female.solid.slice(6.3);
    const stop = female.solid.slice(6.5);
    assert.ok(stop.area() > channel.area());
    channel.delete();
    stop.delete();
    assert.throws(() => engine.variant(a, c.clearances, 4));
  }
});

void test('square bed edges retain full female lips and backing from the first layer', () => {
  const config = {
    ...initialConfig(),
    mode: 'assembly' as const,
    columns: 1,
    rows: 2,
  };
  const [a, b] = makeLayout(config).pods;
  for (const fit of CALIBRATION_FITS) {
    for (const depth of [8, DIM.depth]) {
      const clearances = { ...config.clearances, fit };
      const male = engine.variant(a, clearances, depth);
      const female = engine.variant(b, clearances, depth);
      const placed = female.solid.translate([b.x, b.y, 0]);
      // Independently measured material bands must be present at the bed, not
      // appear only after a bevel. Check both lips, the backing and the T head.
      for (const [body, x, y, thickness] of [
        [placed, -2, 17.575, 0.55],
        [placed, 2, 17.575, 0.55],
        [placed, 0, 19.025, 0.55],
        [male.solid, 2.5, 18.3, 0.9 - 2 * fit],
        [male.solid, 6, 16.95, 0.05],
      ] as const) {
        const cube = engine.api.Manifold.cube([0.02, thickness, 0.01]);
        const witness = cube.translate([x - 0.01, y - thickness / 2, 0.001]);
        const missing = witness.subtract(body);
        assert.ok(missing.volume() < 1e-9, 'full material must reach the bed');
        missing.delete();
        witness.delete();
        cube.delete();
      }
      for (const { solid, sweep } of [male, female]) {
        const upper = solid.slice(0.8);
        for (const z of [0.001, 0.1, 0.3]) {
          const lower = solid.slice(z);
          const missing = upper.subtract(lower);
          const extra = lower.subtract(upper);
          assert.ok(missing.area() < 1e-6 && extra.area() < 1e-6);
          missing.delete();
          extra.delete();
          lower.delete();
        }
        upper.delete();
        const outside = solid.subtract(sweep);
        assert.ok(outside.volume() < 1e-8, 'sweep must contain the entire starting body');
        outside.delete();
      }
      placed.delete();
    }
  }
});

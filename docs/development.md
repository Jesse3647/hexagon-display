# Development

Run commands from the repository root. The editor uses React and TypeScript, Manifold geometry in a browser worker, and Three.js for the preview. Python is only used for optional export verification.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Tests cover connector combinations, mating clearance, assembly layouts, removal paths and STL/3MF exports. Exercise browser flows through the visible controls. Follow [AGENTS.md](../AGENTS.md) when changing source code.

## Generate and verify examples

```sh
pnpm validate:models
python3 scripts/slice-verify.py
```

Model generation overwrites matching examples and the geometry report in [`generated/`](../generated/). The optional slicer check requires Bambu Studio on macOS. It uses temporary profiles and writes slices under ignored `work/`; it does not print or change saved user presets.

For independent export and toolpath checks, install the optional Python dependencies:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements-verify.txt
.venv/bin/python scripts/check-exports.py
```

Run generation and slicing before the independent checker. Pass `--wall-generator arachne` or `--outer-line-width 0.45` to both Python check scripts to generate separate comparison reports.

The reference profile uses an X1 Carbon with a 0.4 mm nozzle, Generic PLA, 0.20 mm layers, three walls, 15% infill, and no supports or brim. The baseline uses Classic, 0.42 mm outer walls, 0.45 mm inner walls, 0.40 mm first-layer lines, thin-wall detection off, and zero elephant-foot compensation. These settings are not embedded in exported model files.

The reports check closed bodies, export positions (including the staggered 2 × 1 layout and cell names after slicer import), sampled extrusion gaps, and material at retaining features. Passing these digital checks does not establish physical fit or repeated reassembly; print calibration samples on the intended printer and material.

## License copies

Keep [`LICENSE`](../LICENSE) and [`public/LICENSE.txt`](../public/LICENSE.txt) identical. The app's footer links to the public copy.

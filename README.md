# Honeycomb Workshop

Design a modular honeycomb display, customize its connectors, and download STL or 3MF files for printing. Build one pod or an interlocking assembly, with solid walls wherever connectors are switched off.

![Generated honeycomb display with ten full pods and two flat-bottom half fillers](docs/images/generated-display.png)

*A five-column display generated in the editor: ten full pods and two half fillers. This is a model preview example of what can be generated.*

## Run locally

Requires Node.js 22.13+ and pnpm. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the Local URL printed in the terminal, normally http://127.0.0.1:3000. On macOS you can also double-click `start-local.command`; it uses an installed Node/pnpm or the Codex bundled runtime when available. Keep that terminal open while using the editor.

For a production build, run `pnpm build`, then `pnpm start`. No account, database, Python service or external geometry API is needed. Dependencies must be installed once; previews and downloads then run on your device. The application is not registered or published to a hosting service.

The app, launcher and package commands live at the repository root. The original Python generator and spline-based exports have been removed; the original design remains in Git history. Current example models and verification reports are in [`generated/`](generated/).

## Editor walkthrough

On desktop, the model stays in view on the left while the configuration panel scrolls on the right. On smaller screens, the sections stack vertically.

### 1. Choose a single pod

Use **Single pod** to make one full hexagon or the upper-half pod. Start with solid walls, then enable just the connectors you need.

![Single pod mode with Full pod and Half pod choices](docs/images/single-pod.png)

### 2. Build an assembly

Switch to **Assembly** and set **Across** and **Tall**. The layout uses staggered columns; Tall counts full-pod cells in each column. Select a cell to remove it, restore it, or change it to a half pod. **Add flat-bottom fillers** fills the short gaps beneath raised columns.

![Assembly layout with five columns, two rows, a selected cell and flat-bottom fillers enabled](docs/images/assembly-layout.png)

Neighbors connect automatically, and exposed edges stay closed. The example has ten full pods and two half fillers. Layouts can be up to 20 × 20, plus applicable fillers; compare the resulting dimensions with your print bed.

### 3. Pick the connectors

Click an edge in the front-view diagram or use its switch. An enabled edge has an integrated rail or channel; a disabled edge becomes an uninterrupted wall. Shared-edge changes update both neighboring pods. Exposed edges can be enabled for future expansion.

![Front-view connector diagram and six labeled edge switches](docs/images/connectors.png)

| Edge | Enabled connector |
| --- | --- |
| N, NE, SE | Male dovetail rail |
| S, SW, NW | Female dovetail channel |

The half pod supports N, NE and NW; its bottom is always solid. Edge labels always refer to the open front, even when you rotate the preview.

### 4. Adjust the fit

Expand **Fit & clearances** to adjust the wall gap, connector clearance and front-stop clearance. Use the same settings for pods that will connect. These values are calibration starting points; print the samples before making a large set.

![Expanded clearance settings with separate sliders for walls, connectors and front stops](docs/images/clearances.png)

### 5. Inspect the model

Drag to orbit and scroll over the model to zoom. **Front**, **Rear** and **Reset** change the view. Click a pod to select it; the darker highlight matches the selected cell in the layout. The measurements show the whole model's width, height, depth and number of separate printable bodies.

![Orbitable assembly preview with view controls, geometry status and overall dimensions](docs/images/preview.png)

The preview uses the same generated meshes as the downloads. **Geometry checked** means the digital checks passed; it does not establish physical fit on your printer.

### 6. Export and preview removal

Use **STL** or **Export 3MF** beneath the preview. The arrow controls step through the order for sliding pods apart; the reset arrow restores the assembled view. Reassembly follows the reverse order.

![STL and 3MF export buttons, removal-step controls and the right-aligned Calibrate fit button](docs/images/exports.png)

Downloads stay disabled while the model is updating or invalid. If a layout contains disconnected groups, an **Export group** selector lets you download one group or all of them. 3MF preserves each pod as a separate component in a positioned assembly.

### 7. Download calibration samples

Click **Calibrate fit** on the right of the export bar. The dialog offers **Print-in-place samples** for testing release after printing and **Separate-fit samples** for testing parts printed apart. Each ZIP contains labeled STL and 3MF samples at three clearances, plus printing instructions.

![Calibration dialog with print-in-place and separate-fit sample downloads](docs/images/calibration.png)

## Model dimensions

The clear opening height is 30 mm, interior depth is 19.65 mm, wall thickness is 2 mm, back thickness is 2.4 mm, and total depth is 22.05 mm. The half pod keeps the original compartment dimensions; male rails are recessed behind the front face.

Flat-bottom fillers are trimmed by half the wall gap (0.15 mm at the default settings) so their floors share the full pods' bottom plane. Irregular silhouettes may leave gaps too tall for one filler; the editor reports these instead of stretching a compartment.

## Fit and printing

Default calibration starting points are 0.30 mm between pod walls, 0.30 mm normal clearance per mating connector surface, and 0.40 mm between male tips and female front stops. Use matching settings when mixing individually generated pods and assemblies. Supported adjustment ranges are 0.20–0.80 mm wall gap, 0.15–0.50 mm fit, and 0.20–1.00 mm axial clearance.

Download the calibration ZIPs for 0.20, 0.30 and 0.40 mm connector fits. Each contains three small, filename-labeled STL/3MF pairs and instructions. Print one file at a time to keep the fit samples identified. Separate-fit strips assemble after printing; print-in-place strips start interlocked. Calibrate with your intended printer, material, nozzle and layer profile.

- Print the solid backs on the build plate, with all parts printed layer by layer.
- Keep the supplied relative part positions. In a slicer import the 3MF assembly as one object with multiple parts, not independently arranged objects.
- Keep supports off. Do not apply automatic gap-closing, XY expansion or brims that bridge the joints. Use elephant-foot compensation appropriate to your calibrated setup.
- Check the sliced layers around the first layer, dovetails and front stops. Model clearances are starting points, not guarantees across materials and printers.
- After cooling, use the editor's step-through sequence to slide the next outside pod toward its open front (+Z). Assemble in reverse order. Interior pods are not intended to pull out independently.
- The recessed front stops align the fronts; this is a sliding connection without a snap latch. Physical fit, rigidity and repeated assembly must be checked with your calibration print.

These integrated connectors are not compatible with older loose joining splines. Keep all pods in the shown orientation; rotating an individual pod in the display changes connector compatibility.

## Export formats

STL is a binary mesh with disconnected closed shells and coordinates in millimeters. STL itself has no unit metadata or part hierarchy.

3MF explicitly declares millimeters and stores each pod as a separate mesh component beneath one positioned assembly. It also embeds the configuration and removal order in `Metadata/honeycomb.json`. It is a model file, not a printer-specific slicer project or G-code.

Downloads are unavailable while generation is pending or when collision checks fail. The last generated preview may remain visible during an update. Mesh and pair caches are bounded; old worker results cannot replace a newer configuration.

## Validation and development

Node serves the editor. Manifold WebAssembly generates printable geometry in a browser worker; Three.js displays the same meshes used by both exporters.

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm validate:models
python3 scripts/slice-verify.py # macOS with Bambu Studio installed
python3 scripts/check-exports.py # optional dependencies below
```

The independent export checker uses Python only for verification. Install its optional dependencies in a virtual environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements-verify.txt
.venv/bin/python scripts/check-exports.py
```

Generate and slice the sample models before running the checker. Python is not needed to launch the editor or download models.

`validate:models` creates representative STLs, 3MFs, calibration ZIPs and a geometry report under `generated/`. The slicer verifier uses bundled Bambu profiles with PLA, a 0.4 mm nozzle, 0.20 mm layers, three walls, 15% infill and no supports. It does not print or change saved user presets. Temporary slices go under ignored `work/`; its summary is `generated/slicer_report.json`.

Tests cover all 64 full and 8 half connector masks, mating directions and clearances, floor alignment, layout edits and disconnected groups, 20 × 20 generation, continuous removal collisions, and STL/3MF round trips. Continuous +Z removal is checked using the exact swept volume of the back/rails and the later-starting front stops, rather than a few sampled positions.

`lib/model/` owns types, layout, geometry, worker and export logic. `components/workshop/` owns the preview and diagrams. The app uses the Sites starter and its existing controls, with a local Node runtime. The optional, feature-detected WebMCP interface exposes `read_honeycomb_configuration` and `configure_honeycomb` using the same editor state.

Digital verification and slicing do not establish physical fit on your printer. Print and test the calibration samples before committing to a large array.

### Verification completed for this version

All 12 automated tests, type checking, source linting and the production build passed. All 11 representative models imported and sliced successfully. The slicer reported only that the generic model files have no filament colors; no slicing errors occurred.

An independent Python round trip confirms 11 STL/3MF pairs contain matching separate closed bodies. Nominal extrusion envelopes remain separated on seven sampled layers in the two example arrays and three print-in-place calibration fits. The default array retains about 0.296–0.300 mm XY gaps at those layers. See `generated/independent_report.json` for exact measurements. This is a sampled digital toolpath check, not a physical print test.

Browser checks covered connector toggles, full/half selection, shared-edge synchronization, removal/restoration and half substitution, flat fillers, the removal preview, rapid configuration changes, both model downloads, both calibration archives, and valid/invalid WebMCP configuration. The narrow 649 px layout was checked for horizontal overflow. The launcher supports the local bundled runtime on this computer.

The source lint command excludes the untouched generated UI catalog and its mobile hook; it checks the editor and model code. Those starter primitives remain type-checked by TypeScript.

## License

[MIT License](LICENSE). Third-party dependencies retain their own licenses.
The footer serves the same license from `public/LICENSE.txt`; keep it in sync with `LICENSE`.

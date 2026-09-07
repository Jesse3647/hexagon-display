# Agent guidance

These instructions apply throughout this repository. Keep source documentation
current in the same change as the implementation it describes.

## Document source changes

- Add or update JSDoc/TSDoc for new or changed project functions, classes, hooks,
  components and shared types. Explain purpose and contracts, not just the name.
- Document component props and shared configuration/result properties next to
  their declarations. State units, coordinate frame, valid ranges, defaults,
  optional/null meanings and indexing conventions where they matter.
- For functions and methods, describe meaningful parameters and return values,
  side effects, mutation, resource ownership, asynchronous behavior and failures.
  Use `@param`, `@returns` and `@throws` when they clarify a nontrivial contract;
  do not repeat information already obvious from the type signature.
- Explain non-obvious geometry, tolerances, transforms, cache keys, stale-result
  handling, and lifecycle cleanup inline. Describe why a constraint exists.
- Document Python functions with docstrings. Give executable scripts a module
  overview covering invocation, prerequisites, output paths, overwrites and
  limits of their checks. Document unusual CSS layout constraints near the rules.
- When behavior changes, revise or remove obsolete comments in the same patch.
  Keep descriptions truthful: a graph-derived removal order is not a collision
  proof, and passing digital checks is not evidence of physical printer fit.
- Keep comments concise. Avoid line-by-line narration, speculative guarantees,
  duplicate prose and broad refactors made only to add comments. Thin unchanged
  starter wrappers do not need repetitive parameter documentation; explain custom
  behavior and extension points when editing them. Preserve third-party notices.
- Update README instructions and focused screenshots when a user-visible change
  makes them inaccurate. Source-level API details belong beside the implementation.

## Code map and invariants

- `app/page.tsx`: editor state, controls, download actions and calibration dialog.
- `components/workshop/`: front-view diagrams and the Three.js mesh preview.
- `lib/model/types.ts`: configuration/property contracts and baseline dimensions.
- `lib/model/layout.ts`: grid placement, compatible adjacency and removal graph.
- `lib/model/geometry.ts`: Manifold solids, cache ownership and continuous sweeps.
- `lib/model/worker.ts` and `use-model.ts`: worker protocol, debounce and revisions.
- `lib/model/export.ts` and `calibration.ts`: printable files and calibration samples.
- `components/ui/`: reusable starter primitives; prefer composition over rewrites.
- `scripts/` and `tests/`: digital geometry, export and optional slicing checks.

Distances are millimeters. From the open front, +X points right, +Y points up,
and +Z points out of the opening; backs sit at Z=0. SVG alone negates Y.
Keep N/NE/SE male and S/SW/NW female. Half pods have only N/NE/NW edges.
Preview and export must use the same generated meshes. Preserve separate closed
pod bodies and assembly transforms; do not fuse adjacent pods to simplify export.
Keep worker replies versioned and never offer stale/invalid meshes for download.
Cached WASM objects belong to GeometryEngine; delete temporary objects and do not
transfer or mutate buffers retained by its cache.

## Verification

Run commands from the repository root with Node.js 22.13+ and pnpm:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Choose checks appropriate to the change. For documentation-only edits, verify
that executable behavior is unchanged and references resolve; do not regenerate
model binaries or re-slice the full set just because comments changed. For model
or export changes, run the relevant geometry/export tests, and use the optional
model and slicer scripts described in README when their coverage is needed.
Report what was actually checked and distinguish digital from physical validation.

The app runs locally. Do not register or publish a hosted site unless requested.

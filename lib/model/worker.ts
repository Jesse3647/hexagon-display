/// <reference lib="webworker" />
/**
 * Browser-only geometry entrypoint. Each worker lazily initializes one engine and
 * retains its caches across model requests. Messages echo id for stale-result
 * rejection; exceptions become serializable error strings instead of escaping.
 */
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { calibrationZip } from './calibration';
import { GeometryEngine } from './geometry';
import type { Configuration } from './types';
/** Shared initialization promise prevents duplicate WASM runtimes during startup. */
let engine: Promise<GeometryEngine> | undefined;
/** Dispatches model generation (default) or a calibration ZIP request. */
self.onmessage = async (
  event: MessageEvent<{
    /** Request revision echoed unchanged in success and failure responses. */
    id: number;
    /** Configuration to validate and generate, or calibration wall/axial settings. */
    config: Configuration;
    /** "calibration" produces ZIP bytes; all other values generate a ModelResult. */
    op?: string;
  }>,
) => {
  const { id, config } = event.data;
  try {
    engine ??= GeometryEngine.create(wasmUrl);
    const api = await engine;
    if (event.data.op === 'calibration') {
      const bytes = calibrationZip(api, config);
      self.postMessage({ id, bytes });
    } else {
      const result = api.generate(config);
      // Structured-clone the arrays. Transferring them would detach buffers
      // still owned by cached variants and break later preview/export requests.
      self.postMessage({ id, result });
    }
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : 'Model generation failed.',
    });
  }
};

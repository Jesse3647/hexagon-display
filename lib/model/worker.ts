/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { calibrationZip } from './calibration';
import { GeometryEngine } from './geometry';
import type { Configuration } from './types';
let engine: Promise<GeometryEngine> | undefined;
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    config: Configuration;
    op?: string;
    separate?: boolean;
  }>,
) => {
  const { id, config } = event.data;
  try {
    engine ??= GeometryEngine.create(wasmUrl);
    const api = await engine;
    if (event.data.op === 'calibration') {
      const bytes = calibrationZip(api, config, !!event.data.separate);
      self.postMessage({ id, bytes });
    } else {
      const result = api.generate(config);
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

'use client';
import { useEffect, useRef, useState } from 'react';
// oxlint-disable-next-line import/default -- Vite provides the worker constructor.
import ModelWorker from './worker?worker';
import { isCurrentResult } from './revisions';
import type { Configuration, ModelResult } from './types';

/**
 * Owns one geometry worker for the mounted editor and debounces edits by 120 ms.
 * @param config Complete current configuration; changes invalidate older responses.
 * @returns Last mesh, pending status for the current request, and current error.
 * A pending/error result can retain the old preview; callers must gate exports on
 * pending, error and result.errors, never merely on the existence of a mesh.
 * The worker is terminated on unmount; a 30-second timeout reports failure but
 * does not cancel WASM computation already running in that worker.
 */
export function useModel(config: Configuration) {
  // Revision IDs arbitrate replies; serialized keys also make pending true
  // during the render before the effect has posted the next job.
  const worker = useRef<Worker | null>(null),
    revision = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [response, setResponse] = useState<{
    key: string;
    result: ModelResult | null;
    error: string;
  }>({ key: '', result: null, error: '' });
  const key = JSON.stringify(config);
  useEffect(() => {
    worker.current = new ModelWorker();
    return () => {
      worker.current?.terminate();
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    const id = ++revision.current,
      w = worker.current!;
    /** Associates a failure with this configuration while preserving the last preview. */
    const fail = (error: string) =>
      setResponse((previous) => ({ ...previous, key, error }));
    w.onmessage = (
      event: MessageEvent<{ id: number; result?: ModelResult; error?: string }>,
    ) => {
      if (!isCurrentResult(event.data.id, revision.current)) return;
      clearTimeout(timer.current);
      setResponse((previous) => ({
        key,
        result: event.data.result ?? previous.result,
        error: event.data.error ?? '',
      }));
    };
    w.onerror = () => {
      clearTimeout(timer.current);
      fail('The geometry worker could not run. Reload the editor to retry.');
    };
    // Debouncing avoids posting every slider tick. An older job may finish
    // during this delay, but its revision cannot replace the newer selection.
    const debounce = setTimeout(() => {
      w.postMessage({ id, config });
      timer.current = setTimeout(
        () =>
          fail(
            'Generation took too long. Try a smaller layout or reload the editor.',
          ),
        30000,
      );
    }, 120);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timer.current);
    };
  }, [key, config]);
  return {
    /** Most recent mesh, possibly from an earlier configuration while updating. */
    result: response.result,
    /** True until this configuration receives a result or reported failure. */
    pending: response.key !== key,
    /** Error for this configuration only; stale failures are hidden. */
    error: response.key === key ? response.error : '',
  };
}

'use client';
import { useEffect, useRef, useState } from 'react';
// oxlint-disable-next-line import/default -- Vite provides the worker constructor.
import ModelWorker from './worker?worker';
import { isCurrentResult } from './revisions';
import type { Configuration, ModelResult } from './types';

export function useModel(config: Configuration) {
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
    result: response.result,
    pending: response.key !== key,
    error: response.key === key ? response.error : '',
  };
}

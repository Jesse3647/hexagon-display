import { validateConfig, type Configuration } from './types';
/** Minimal optional browser tool contract, kept local so the editor needs no WebMCP runtime dependency. */
interface Tool {
  /** Stable machine-facing operation name. */
  name: string;
  /** Human-readable operation label. */
  title: string;
  /** Explains visible effects and limitations to callers. */
  description: string;
  /** JSON Schema describing accepted input; execution still validates values. */
  inputSchema: object;
  /** Tool-discovery hints; they do not bypass runtime validation or user permissions. */
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  /** Runs against the live editor; may return a result or a promise. */
  execute: (input: unknown) => unknown;
}
/**
 * Registers read/configure tools when the browser exposes document.modelContext.
 * @param read Returns the latest configuration; use a ref to avoid a stale closure.
 * @param write Replaces editor configuration after runtime validation and cloning.
 * @param status Returns current generation status without waiting for it to finish.
 * @returns Cleanup callback that aborts registrations, or undefined when unsupported.
 * Registration failure must not prevent normal use of the editor. Configuring
 * changes visible state only; it does not download, publish, slice or print.
 */
export function registerWorkshopTools(
  read: () => Configuration,
  write: (c: Configuration) => void,
  status: () => object,
) {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool: (
          tool: Tool,
          options: { signal: AbortSignal },
        ) => void | Promise<void>;
      };
    }
  ).modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  /** Isolates sync and async capability failures from ordinary editor operation. */
  const register = (tool: Tool) => {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Browsers without this optional capability retain the full editor. */
    }
  };
  register({
    name: 'read_honeycomb_configuration',
    title: 'Read honeycomb configuration',
    description:
      'Read the current editor configuration and model generation status.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => ({ configuration: read(), status: status() }),
  });
  register({
    name: 'configure_honeycomb',
    title: 'Configure honeycomb model',
    description:
      'Update the visible editor configuration. This starts model generation; it does not download or print a model.',
    inputSchema: {
      type: 'object',
      properties: {
        configuration: {
          type: 'object',
          description:
            'Complete configuration returned by read_honeycomb_configuration.',
        },
      },
      required: ['configuration'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async (input) => {
      const config = (input as { configuration?: Configuration })
        ?.configuration;
      if (!config) throw new Error('A complete configuration is required.');
      const errors = validateConfig(config);
      if (errors.length) throw new Error(errors.join(' '));
      write(structuredClone(config));
      // Give React a chance to render the change; two frames do not imply the
      // worker finished. Callers must read status separately to observe completion.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return { configured: true, generation: 'pending' };
    },
  });
  return () => lifecycle.abort();
}

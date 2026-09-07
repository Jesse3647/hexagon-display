import { validateConfig, type Configuration } from './types';
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
}
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
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return { configured: true, generation: 'pending' };
    },
  });
  return () => lifecycle.abort();
}

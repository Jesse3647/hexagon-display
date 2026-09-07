import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
/** Local Node/Vinext setup; the browser worker uses ESM so its bundled WASM URL resolves correctly. */
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [vinext()],
  worker: { format: 'es' },
  server: { host: '127.0.0.1', watch: { usePolling: true } },
});

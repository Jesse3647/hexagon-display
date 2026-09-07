import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [vinext()],
  worker: { format: 'es' },
  server: { host: '127.0.0.1', watch: { usePolling: true } },
});

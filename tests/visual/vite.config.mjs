/*
 * Visual-check harness (not shipped): renders Macroma pages with mockup
 * fixtures so headless Chrome can screenshot them next to the approved
 * mockups. Run: npx vite --config tests/visual/vite.config.mjs, then
 * node tests/visual/shoot.cjs <out-dir>.
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  plugins: [vue(), tailwindcss()],
  server: { port: 5611, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
});

import { defineConfig } from 'vite';
import { capturePlugin } from './tools/capture-plugin.js';

const SHOT_DIR =
  process.env.AETHER_SHOT_DIR ??
  'C:/Users/ajink/AppData/Local/Temp/claude/D--PhD-Backup-OneDrive---Aalto-University-Projects-XR-interfaces-idea-1/2e5ede68-b8d4-4a0c-9b75-38ce822686c2/scratchpad';

export default defineConfig({
  base: './',
  plugins: [capturePlugin(SHOT_DIR)],
  server: { host: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});

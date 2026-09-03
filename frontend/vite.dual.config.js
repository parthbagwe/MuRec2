import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const serviceConfig = JSON.parse(readFileSync(new URL('./public/service-config.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react(), {
    name: 'cerum-dual-api', enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.replaceAll('\\', '/').includes('/src/') && /^(\.\/|\.\.\/)api(?:\.js)?$/.test(source)) {
        return fileURLToPath(new URL('./src/dual/api.js', import.meta.url));
      }
    },
  }],
  define: {
    'import.meta.env.VITE_FIREBASE_CONFIG_URL': JSON.stringify('/firebase-config.json'),
    'import.meta.env.VITE_CERUM_PRIMARY_PROVIDER': JSON.stringify(serviceConfig.primary),
  },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  build: { outDir: 'dist-dual' },
});

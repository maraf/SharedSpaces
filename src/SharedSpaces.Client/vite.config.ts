import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: 'localhost',
    port: parseInt(process.env.PORT || '5173'),
  },
  preview: {
    host: 'localhost',
    port: 4173,
  },
});

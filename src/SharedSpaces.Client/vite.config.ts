import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Fallback for /_share POST when the Service Worker isn't active yet
 * (first visit, or dev mode before SW installs). Redirects to / so the
 * browser doesn't show a 404. The share data is lost in this edge case,
 * but it only happens once — subsequent shares are intercepted by the SW.
 */
function shareTargetFallback(): Plugin {
  return {
    name: 'share-target-fallback',
    configureServer(server) {
      server.middlewares.use('/_share', (_req, res) => {
        res.writeHead(303, { Location: '/' });
        res.end();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/_share', (_req, res) => {
        res.writeHead(303, { Location: '/' });
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    shareTargetFallback(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: 'auto',
      manifest: false,
      devOptions: {
        enabled: true,
        type: 'module',
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

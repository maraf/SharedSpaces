import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    host: 'localhost',
    port: parseInt(process.env.PORT || '5173'),
  },
  preview: {
    host: 'localhost',
    port: 4173,
  },
});

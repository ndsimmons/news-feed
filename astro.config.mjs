// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        // Proxy API requests to the local worker
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true
        }
      }
    }
  }
});
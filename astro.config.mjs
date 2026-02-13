// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  integrations: [react(), tailwind()],

  vite: {
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
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
        // Proxy API requests to production worker (has 101 articles!)
        // Use 'http://localhost:8787' for local development
        '/api': {
          target: 'https://news-feed-api.nsimmons.workers.dev',
          changeOrigin: true
        }
      }
    }
  }
});
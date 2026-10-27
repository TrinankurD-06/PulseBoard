import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig(({ command }) => {
  // The root .env sets NODE_ENV=development for the API, and Vite turns a
  // NODE_ENV found in .env into a development build (dev React, jsxDEV).
  // Claiming the slot first, with an empty value, keeps `vite build` on
  // production; `vite` (dev server) is development either way.
  if (command === 'build') process.env.VITE_USER_NODE_ENV = '';

  return {
    plugins: [react(), tailwindcss()],
    // `@/…` imports, as shadcn/ui components expect.
    resolve: { alias: { '@': path.resolve(srcDir) } },
    // Read VITE_* variables from the monorepo-root .env.
    envDir: '../..',
    server: {
      port: 5173,
      // Mirrors the Vercel rewrite in production: the browser talks to its own
      // origin, so the refresh cookie is first-party.
      proxy: { '/api': 'http://localhost:4000' },
    },
  };
});

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_* variables from the monorepo-root .env.
  envDir: '../..',
  server: {
    port: 5173,
    // Mirrors the Vercel rewrite in production: the browser talks to its own
    // origin, so the refresh cookie is first-party.
    proxy: { '/api': 'http://localhost:4000' },
  },
});

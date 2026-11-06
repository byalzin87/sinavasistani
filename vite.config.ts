import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
  const isBuild = command === 'build';
  // Use '/sinavasistani/' for production GitHub Pages build, and '/' for Vercel and local dev server
  const base = isVercel ? '/' : (isBuild ? '/sinavasistani/' : '/');

  return {
    plugins: [react()],
    base,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      chunkSizeWarningLimit: 1200,
    }
  };
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep the old CRA variable name working: REACT_APP_API_URL in .env
  envPrefix: ['VITE_', 'REACT_APP_'],
  build: { outDir: 'dist', sourcemap: false },
  // In dev, forward /api to the Node server (npm run dev:api).
  server: { port: 5173, proxy: { '/api': 'http://localhost:5000' } },
});

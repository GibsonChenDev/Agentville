import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri expects a fixed port and no clearing of its output.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'safari16',
    chunkSizeWarningLimit: 1500,
  },
});

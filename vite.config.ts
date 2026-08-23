import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React Flow is the heaviest dependency and changes rarely; splitting it
        // out keeps it cached across app updates.
        manualChunks: {
          canvas: ['@xyflow/react'],
        },
      },
    },
  },
});

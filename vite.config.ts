import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split the eagerly-loaded framework vendors out of the entry chunk.
        // Everything else stays auto-assigned: a catch-all would drag lazy
        // graphs (three.js, recharts, …) back into the initial payload.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](konva|react-konva)[\\/]/.test(id)) return 'vendor-konva';
          // Heavy lazy graphs: never in the initial payload — loaded on demand
          // when the 3D viewer, robotics, or simulation panels open.
          if (/[\\/]node_modules[\\/](three|@react-three)[\\/]/.test(id)) return 'vendor-three';
          if (/[\\/]node_modules[\\/](recharts|d3-.*)[\\/]/.test(id)) return 'vendor-charts';
          return undefined;
        },
      },
    },
  },
});

import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) {
            return 'three-vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});

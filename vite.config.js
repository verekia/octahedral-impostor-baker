import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Use relative paths for deployment
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  }
});

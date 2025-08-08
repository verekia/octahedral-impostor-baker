import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // development server configuration
  server: {
    port: 5173,
    open: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        webgpu: 'webgpu.html',
      },
    },
  },
})

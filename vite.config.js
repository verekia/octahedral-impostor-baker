import { defineConfig } from "vite";

export default defineConfig({
  // development server configuration
  server: {
    port: 5173,
    open: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        webgpu: "webgpu.html",
      },
    },
  },
});

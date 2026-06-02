import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        game: resolve(__dirname, "index.html"),
        benchmark: resolve(__dirname, "benchmark.html"),
      },
    },
  },
});

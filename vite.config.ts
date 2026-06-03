import { defineConfig } from "vite";
import { resolve } from "node:path";
import { parseDeploymentMode } from "./src/client/deployment/mode";

const deploymentMode = parseDeploymentMode(process.env.VITE_SKETCH_RTS_DEPLOYMENT);
const buildInput =
  deploymentMode === "static"
    ? { game: resolve(__dirname, "index.html") }
    : {
        game: resolve(__dirname, "index.html"),
        benchmark: resolve(__dirname, "benchmark.html"),
      };

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: buildInput,
    },
  },
});

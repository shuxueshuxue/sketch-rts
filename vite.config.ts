import { defineConfig } from "vite";
import { resolve } from "node:path";
import { parseDeploymentMode } from "./src/client/deployment/mode";
import { publicBasePathFromEnv } from "./src/shared/deployment-base";
import { resourceManifest,writeResourceManifest } from './tools/resource-manifest';

const deploymentMode = parseDeploymentMode(process.env.VITE_SKETCH_RTS_DEPLOYMENT);
const publicBasePath = publicBasePathFromEnv(process.env);
const buildInput =
  deploymentMode === "static"
    ? { game: resolve(__dirname, "index.html") }
    : {
        game: resolve(__dirname, "index.html"),
        benchmark: resolve(__dirname, "benchmark.html"),
      };

export default defineConfig({
  plugins:[{
    name:'resource-sizes',
    configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')){next();return;}try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await resourceManifest(resolve(__dirname,'public'))));}catch(error){next(error);}});},
    async closeBundle(){await writeResourceManifest(resolve(__dirname,'dist'));},
  }],
  base: publicBasePath,
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: buildInput,
      output:{onlyExplicitManualChunks:true,manualChunks(id){if(id.includes('/node_modules/three/'))return 'world-vendor';if(id.includes('/client/world3d/'))return 'world3d';}},
    },
  },
});

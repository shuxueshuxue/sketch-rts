/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SKETCH_RTS_DEPLOYMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

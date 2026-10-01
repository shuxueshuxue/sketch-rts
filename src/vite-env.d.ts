/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SKETCH_RTS_DEPLOYMENT?: string;
  // The sound pack played until the player chooses one (see @@@sound-packs); unset, the game is silent.
  readonly VITE_SOUND_PACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

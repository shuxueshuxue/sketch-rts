import type { RecordingScene } from "../scene";
import { cavalryFlank } from "./cavalry-flank";
import { infantryClash } from "./infantry-clash";

/** Scenes the CLI knows by name; any other scene module can be recorded by path. */
export const RECORDING_SCENES: Record<string, RecordingScene> = Object.fromEntries([infantryClash, cavalryFlank].map((scene) => [scene.name, scene]));

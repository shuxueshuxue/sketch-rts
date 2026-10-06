import { deckBattle } from "./deck-battle";
import type { RecordingScene } from "../scene";
import { cavalryCharge } from "./cavalry-charge";
import { cavalryFlank } from "./cavalry-flank";
import { ashenMarch } from "./ashen-march";
import { infantryClash } from "./infantry-clash";

/** Scenes the CLI knows by name; any other scene module can be recorded by path. */
export const RECORDING_SCENES: Record<string, RecordingScene> = Object.fromEntries([deckBattle, infantryClash, cavalryFlank, cavalryCharge, ashenMarch].map((scene) => [scene.name, scene]));

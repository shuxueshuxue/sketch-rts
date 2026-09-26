import { ASHEN_MARCH } from "../../campaigns/ashen-march";
import { campaignDriver } from "../../story/campaign";
import { defineRecordingScene } from "../scene";

// The whole Ashen March campaign, played through by its pilot. Its chapters can be filmed one at a time with
// ASHEN_FROM=<chapter id> (the chapter starts from a fresh party, as a save would not).
export const ashenMarch = defineRecordingScene({
  name: "ashen-march",
  description: "《灰烬边境》 the story campaign, played through by its pilot (about 45 minutes).",
  createGame: () => {
    throw new Error("ashen-march is a story: record it through its story driver");
  },
  story: () => campaignDriver(ASHEN_MARCH, process.env.ASHEN_FROM ? { from: process.env.ASHEN_FROM } : {}),
  defaults: { seconds: 60 * 60, fps: 30, width: 1280, height: 720, camera: { type: "follow", zoom: 1.25, lagSeconds: 0.7 } },
});

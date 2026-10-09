import { describe, expect, it } from "vitest";
import { createRoomHost } from "../../server/room-host";
import type { BootstrapAiVersion, RaceId } from "../../shared/types";
import { StaticSoloDeploymentRuntime } from "./static-runtime";

const families: BootstrapAiVersion[] = ["v9_archer", "v9_summoner", "v9_knight"];
const races: RaceId[] = ["grove", "ember"];

describe("selectable room AI", () => {
  it.each(families.flatMap(aiVersion => races.map(race => ({ aiVersion, race }))))(
    "runs $aiVersion / $race identically in a local and hosted room",
    async ({ aiVersion, race }) => {
      const user = { id: "host", name: "Host" };
      const input = {
        id: `room-${aiVersion}-${race}`, host: user, mapId: "bareDuel" as const,
        humanCount: 1, aiCount: 1,
        seatSetup: [
          { controller: "human" as const, race: "grove" as const, team: "team-1" },
          { controller: "ai" as const, race, aiVersion, team: "team-2" },
        ],
      };
      let now = 0;
      const local = new StaticSoloDeploymentRuntime({ now: () => now, tickMs: 1 });
      const hosted = createRoomHost({ autoTick: false });
      await local.createRoom(input);
      hosted.createRoom(input);
      const match = await local.startRoom(input.id, user);
      const room = hosted.startRoom(input.id);
      try {
        expect(match.room.slots[1]!.aiVersion).toBe(aiVersion);
        expect(room.slots[1]!.aiVersion).toBe(aiVersion);
        for (let tick = 0; tick < 180; tick++) {
          now++;
          match.adapter.updateToRenderTime();
        }
        hosted.tickRoom(input.id, 180);
        const snapshot = match.adapter.currentSnapshot()!;
        expect(snapshot.tick).toBe(180);
        expect(snapshot).toEqual(hosted.snapshot(input.id));
        expect(snapshot.match.stats.goldSpent.enemy).toBeGreaterThan(0);
        expect(snapshot.units.some(unit => unit.owner === "enemy" && unit.order.type === "mine")).toBe(true);
      } finally {
        match.adapter.close();
        local.close();
      }
    },
  );
});

import { describe, expect, it } from "vitest";
import { StaticSoloDeploymentRuntime } from "../client/deployment/static-runtime";
import type { LocalUserProfile } from "../shared/types";
import { createRoomHost } from "./room-host";

const hostUser: LocalUserProfile = { id: "user-host", name: "Host" };
const guestUser: LocalUserProfile = { id: "user-guest", name: "Guest" };

let now = 0;

async function startStaticTwoHumanRoom() {
  const runtime = new StaticSoloDeploymentRuntime({ tickMs: 50, now: () => now });
  await runtime.createRoom({ id: "static-command-core", host: hostUser, mapId: "bareDuel", humanCount: 2, aiCount: 0 });
  await runtime.enterRoom("static-command-core", guestUser);
  await runtime.updateRoomSlot("static-command-core", "slot-2", { ready: true, team: "south" });
  return runtime.startRoom("static-command-core", hostUser);
}

function startHostedTwoHumanRoom() {
  const host = createRoomHost({ autoTick: false });
  const room = host.createRoom({ id: "hosted-command-core", host: hostUser, mapId: "bareDuel", humanCount: 2, aiCount: 0 });
  host.joinRoom(room.id, guestUser);
  host.updateSlot(room.id, "slot-2", { ready: true, team: "south" });
  host.startRoom(room.id);
  return host;
}

describe("deployment command-frame gameplay core", () => {
  it("applies representative static and hosted room commands through equivalent frame semantics", async () => {
    const staticMatch = await startStaticTwoHumanRoom();
    const hosted = startHostedTwoHumanRoom();
    const staticBefore = staticMatch.snapshot;
    const hostedBefore = hosted.snapshot("hosted-command-core");
    const staticWorker = staticBefore.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const hostedWorker = hostedBefore.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(staticWorker).toBeDefined();
    expect(hostedWorker).toBeDefined();
    expect(staticWorker!.id).toBe(hostedWorker!.id);
    const command = { type: "move" as const, unitIds: [staticWorker!.id], x: staticWorker!.x + 96, y: staticWorker!.y + 32 };

    // A local command lands on the next tick, as the hosted frame below lands on its own.
    staticMatch.adapter.sendCommand(command);
    now += 50;
    staticMatch.adapter.updateToRenderTime();
    const hostedAfter = hosted.tickRoomFrame("hosted-command-core", { roomId: "hosted-command-core", tick: 0, sequence: 0, commands: [{ playerId: "player", command }] }, "browser").snapshot;
    const staticAfter = staticMatch.adapter.currentSnapshot();
    expect(staticAfter).toBeDefined();
    if (!staticAfter) throw new Error("expected static adapter to expose a post-command snapshot");

    expect(staticAfter.tick).toBe(1);
    expect(hostedAfter.tick).toBe(1);
    expect(staticAfter.units).toEqual(hostedAfter.units);
    expect(staticAfter.buildings).toEqual(hostedAfter.buildings);
    expect(staticAfter.resources).toEqual(hostedAfter.resources);
    expect(staticAfter.match).toEqual(hostedAfter.match);
  });
});

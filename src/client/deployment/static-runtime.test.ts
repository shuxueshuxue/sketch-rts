import { describe, expect, it } from "vitest";
import type { LocalUserProfile } from "../../shared/types";
import { StaticSoloDeploymentRuntime } from "./static-runtime";

const host: LocalUserProfile = { id: "host", name: "Host" };

describe("static solo deployment runtime", () => {
  it("keeps room browser data in a local registry", async () => {
    const runtime = new StaticSoloDeploymentRuntime();

    const created = await runtime.createRoom({ id: "room-1", host, name: "Local Room", mapId: "bareDuel", humanCount: 1, aiCount: 1, visibility: "public" });
    const rooms = await runtime.listRooms(host.id);

    expect(created).toMatchObject({ id: "room-1", name: "Local Room", status: "open" });
    expect(rooms.map((room) => room.id)).toEqual(["room-1"]);
  });

  it("uses shared room helpers for map, slot, and slot-count edits", async () => {
    const runtime = new StaticSoloDeploymentRuntime();
    await runtime.createRoom({ id: "room-setup", host, humanCount: 1, aiCount: 1 });

    await runtime.updateRoomMap("room-setup", "wildMarches");
    await runtime.updateRoomSlotCounts("room-setup", 1, 2);
    const room = await runtime.updateRoomSlot("room-setup", "slot-2", { controller: "ai", team: "south" });

    expect(room.mapId).toBe("wildMarches");
    expect(room.slots).toHaveLength(3);
    expect(room.slots[1]).toMatchObject({ controller: "ai", team: "south", ready: true });
  });

  it("starts a local match and advances AI-driven ticks without backend transport", async () => {
    let runtimeNow = 0;
    const runtime = new StaticSoloDeploymentRuntime({ now: () => runtimeNow });
    await runtime.createRoom({ id: "room-live", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });

    const started = await runtime.startRoom("room-live", host);
    const beforeTick = started.snapshot.tick;
    runtimeNow += 1_000;
    const changed = started.adapter.updateToRenderTime();
    const after = started.adapter.currentSnapshot();

    expect(started.room.status).toBe("inMatch");
    expect(changed).toBe(true);
    expect(after?.tick).toBeGreaterThan(beforeTick);
    expect(after?.units.some((unit) => unit.owner === "enemy" && unit.order)).toBe(true);
  });
});

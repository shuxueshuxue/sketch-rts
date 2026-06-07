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

  it("validates local room setup through the shared runtime schema", async () => {
    const runtime = new StaticSoloDeploymentRuntime();

    await expect(runtime.createRoom({ id: "room-invalid", host, mapId: "missing-map" as never })).rejects.toThrow("Malformed room create input");
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

  it("uses the local command-frame admission path for player commands", async () => {
    const runtime = new StaticSoloDeploymentRuntime();
    await runtime.createRoom({ id: "room-local-admission", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    const started = await runtime.startRoom("room-local-admission", host);
    const townHall = started.snapshot.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(townHall).toBeDefined();

    expect(() => started.adapter.sendCommand({ type: "train", buildingId: townHall!.id, unitKind: "footman" })).toThrow(/Local command rejected: townHall cannot train footman/);

    const after = started.adapter.currentSnapshot();
    expect(after?.tick).toBe(0);
    expect(after?.buildings.find((building) => building.id === townHall!.id)?.queue).toHaveLength(0);
  });

  it("can concede a local match into ordinary room results", async () => {
    const runtime = new StaticSoloDeploymentRuntime();
    await runtime.createRoom({ id: "room-concede", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    await runtime.startRoom("room-concede", host);

    const ended = await runtime.forfeitMatch("room-concede", host);

    expect(ended.status).toBe("ended");
    expect(ended.result).toMatchObject({ winner: "enemy" });
    expect(ended.result?.slots.map((slot) => slot.playerId)).toEqual(["player", "enemy"]);
  });

  it("uses the shared chat message semantics for local match chat", async () => {
    const runtime = new StaticSoloDeploymentRuntime({ now: () => 1200 });
    await runtime.createRoom({ id: "room-chat", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    const started = await runtime.startRoom("room-chat", host);
    const received: string[] = [];
    started.chat.onMessage((message) => received.push(`${message.id}|${message.senderName}|${message.text}|${message.sentAt}`));

    started.chat.send(" push mid ", "Ada");

    expect(received).toEqual(["chat-room-chat-1|Ada|push mid|1200"]);
    expect(() => started.chat.send("   ", "Ada")).toThrow("Chat message cannot be empty");
  });
});

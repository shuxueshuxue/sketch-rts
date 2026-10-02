import { describe, expect, it } from "vitest";
import { createRoom, type CreateRoomInput } from "../../shared/rooms";
import { createDeploymentRuntime } from "./runtime";

describe("deployment runtime factory", () => {
  it("does not create server room transports in static mode", () => {
    let roomTransports = 0;

    const runtime = createDeploymentRuntime("static", {
      createRoomTransport() {
        roomTransports += 1;
        throw new Error("static mode must not create a room transport");
      },
    });

    expect(runtime.kind).toBe("static");
    expect(roomTransports).toBe(0);
  });

  it("reports static runtime readiness through the same boot callback", () => {
    let ready = 0;
    const runtime = createDeploymentRuntime("static", {
      onRuntimeReady() {
        ready += 1;
      },
    });

    runtime.initialAdapter();

    expect(ready).toBe(1);
  });

  it("plays a private room in the browser, asking the server nothing, and a public room on the server", async () => {
    const host = { id: "user-host", name: "Host" };
    const served = createRoom({ id: "room-served", host: { id: "user-other", name: "Other" }, visibility: "public" });
    const requests: string[] = [];
    const runtime = createDeploymentRuntime("server", {
      tickMs: 1_000_000,
      fetchJson: async <T>(path: string, body?: unknown) => {
        requests.push(`${body ? "POST" : "GET"} ${path}`);
        if (body && path === "/api/rooms") return createRoom(body as CreateRoomInput) as T;
        return { rooms: [served] } as T;
      },
    });

    const mine = await runtime.createRoom({ id: "room-mine", host, visibility: "private", humanCount: 1, aiCount: 1 });
    expect(runtime.isLocalRoom(mine.id)).toBe(true);
    await runtime.updateRoomSlot(mine.id, "slot-2", { race: "ember" });
    const started = await runtime.startRoom(mine.id, host);
    expect(started.room.status).toBe("inMatch");
    expect(runtime.canForfeitMatch(mine.id)).toBe(true);
    expect(requests).toEqual([]);

    const shared = await runtime.createRoom({ id: "room-shared", host, visibility: "public", humanCount: 2, aiCount: 0 });
    expect(runtime.isLocalRoom(shared.id)).toBe(false);
    expect(runtime.canForfeitMatch(shared.id)).toBe(false);
    expect(requests).toEqual(["POST /api/rooms"]);
    // The room browser shows the player's own rooms here and the server's.
    expect((await runtime.listRooms(host.id)).map((room) => room.id)).toEqual(["room-mine", "room-served"]);
    started.adapter.close();
    runtime.close();
  });
});

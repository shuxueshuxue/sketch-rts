import { describe, expect, it } from "vitest";
import { createRoom } from "../shared/rooms";
import { roomSetupViewAction } from "./room-view-state";

describe("room setup view state", () => {
  it("enters the match instead of rendering stale setup controls for in-match rooms", () => {
    const room = { ...createRoom({ id: "room-in-match", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };

    expect(roomSetupViewAction(room)).toBe("enterMatch");
  });
});

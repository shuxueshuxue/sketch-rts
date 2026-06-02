import { describe, expect, it } from "vitest";
import { classifyWebSocketUpgrade } from "./ws-routes";

describe("websocket route classifier", () => {
  it("keeps session and room websocket paths explicit", () => {
    expect(classifyWebSocketUpgrade("/ws/session")).toEqual({ type: "session" });
    expect(classifyWebSocketUpgrade("/ws/rooms/room%201")).toEqual({ type: "room", roomId: "room 1" });
    expect(classifyWebSocketUpgrade("/ws")).toEqual({ type: "reject" });
    expect(classifyWebSocketUpgrade("/ws/rooms")).toEqual({ type: "reject" });
  });
});

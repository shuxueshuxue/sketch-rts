import { describe, expect, it } from "vitest";
import { classifyWebSocketUpgrade } from "./ws-routes";

describe("websocket route classifier", () => {
  it("keeps room websocket paths explicit and rejects global session sockets", () => {
    expect(classifyWebSocketUpgrade("/ws/session")).toEqual({ type: "reject" });
    expect(classifyWebSocketUpgrade("/ws/rooms/room%201")).toEqual({ type: "room", roomId: "room 1" });
    expect(classifyWebSocketUpgrade("/ws")).toEqual({ type: "reject" });
    expect(classifyWebSocketUpgrade("/ws/rooms")).toEqual({ type: "reject" });
  });

  it("classifies room websocket paths under a deployment base path", () => {
    expect(classifyWebSocketUpgrade("/sketch-rts/ws/rooms/room%201", "/sketch-rts/")).toEqual({ type: "room", roomId: "room 1" });
    expect(classifyWebSocketUpgrade("/ws/rooms/room%201", "/sketch-rts/")).toEqual({ type: "reject" });
  });
});

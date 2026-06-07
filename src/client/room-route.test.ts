import { describe, expect, it } from "vitest";
import { formatRoomRouteHash, parseRoomRouteHash } from "./room-route";

describe("room route hash", () => {
  it("round-trips a room id without depending on server path routing", () => {
    const hash = formatRoomRouteHash({ screen: "room", roomId: "room public/1" });

    expect(hash).toBe("#room=room%20public%2F1");
    expect(parseRoomRouteHash(hash)).toEqual({ screen: "room", roomId: "room public/1" });
  });

  it("keeps menu-only routes separate from hosted room ids", () => {
    expect(parseRoomRouteHash("#rooms")).toEqual({ screen: "rooms" });
    expect(parseRoomRouteHash("#profile")).toEqual({ screen: "profile" });
    expect(parseRoomRouteHash("")).toEqual({ screen: "home" });
  });
});

import { MAP_POOL, poolMap, type PoolMapId } from "../shared/map-pool";
import { createRoom, roomConfiguration, type RoomConfiguration } from "../shared/rooms";
import { parseCreateRoomRequest } from "../shared/room-schema";

export type RoomRoute = { screen: "home" | "profile" | "rooms" } | { screen: "create"; configuration?: RoomConfiguration } | { screen: "room"; roomId: string };
const previewHost = { id: "preview", name: "Preview" };

export function defaultRoomConfiguration(mapId: PoolMapId = MAP_POOL[0].id): RoomConfiguration {
  const map = poolMap(mapId)!;
  return roomConfiguration(createRoom({ id: "preview", host: previewHost, name: "", mapId, humanCount: 1, aiCount: map.players - 1, visibility: "private" }));
}

// One query-based route works at every deployment mount, without a second hash router.
export function formatRoomRoute(route: RoomRoute): string {
  const query = new URLSearchParams();
  if (route.screen === "room") query.set("room", route.roomId);
  else if (route.screen === "create") {
    const config = route.configuration ?? defaultRoomConfiguration();
    query.set("map", config.mapId);
    query.set("seed", config.layoutSeed);
    if (config.name) query.set("name", config.name);
    query.set("visibility", config.visibility);
    query.set("seats", config.seatSetup.map(seat => [seat.controller, seat.team, seat.race, seat.controller === "ai" ? seat.aiVersion ?? "random" : ""].join(":")).join(","));
  } else if (route.screen !== "home") query.set("view", route.screen);
  return query.size ? `?${query}` : "";
}

export function parseRoomRoute(search: string): RoomRoute {
  const query = new URLSearchParams(search);
  const roomId = query.get("room");
  if (roomId) return { screen: "room", roomId };
  const mapId = query.get("map");
  if (mapId) {
    const map = poolMap(mapId);
    if (!map) return { screen: "home" };
    const defaults = defaultRoomConfiguration(map.id as PoolMapId);
    const seats = query.get("seats")?.split(",").map(encoded => {
      const [controller, team, race, aiVersion] = encoded.split(":");
      return { controller, team, race, ...(aiVersion ? { aiVersion } : {}) };
    }) ?? defaults.seatSetup;
    const input = parseCreateRoomRequest({ host: previewHost, mapId, name: query.get("name") ?? "",
      visibility: query.get("visibility") ?? defaults.visibility,
      layoutSeed: query.get("seed") ?? defaults.layoutSeed,
      humanCount: seats.filter(seat => seat.controller !== "ai").length,
      aiCount: seats.filter(seat => seat.controller === "ai").length, seatSetup: seats });
    if (!input || seats.length !== map.players) return { screen: "home" };
    return { screen: "create", configuration: roomConfiguration(createRoom({ ...input, id: "preview" })) };
  }
  const view = query.get("view");
  return { screen: view === "profile" || view === "rooms" ? view : "home" };
}

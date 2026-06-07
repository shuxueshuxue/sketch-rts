export type RoomRoute = { screen: "home" } | { screen: "profile" } | { screen: "rooms" } | { screen: "create" } | { screen: "room"; roomId: string };

export function formatRoomRouteHash(route: RoomRoute): string {
  if (route.screen === "room") return `#room=${encodeURIComponent(route.roomId)}`;
  if (route.screen === "home") return "";
  return `#${route.screen}`;
}

export function parseRoomRouteHash(hash: string): RoomRoute {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) return { screen: "home" };
  if (normalized === "profile") return { screen: "profile" };
  if (normalized === "rooms") return { screen: "rooms" };
  if (normalized === "create") return { screen: "create" };
  if (normalized.startsWith("room=")) return { screen: "room", roomId: decodeURIComponent(normalized.slice("room=".length)) };
  return { screen: "home" };
}

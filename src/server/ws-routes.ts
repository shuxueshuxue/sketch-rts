export type WebSocketUpgradeRoute = { type: "session" } | { type: "room"; roomId: string } | { type: "reject" };

export function classifyWebSocketUpgrade(rawUrl: string | undefined): WebSocketUpgradeRoute {
  const url = new URL(rawUrl ?? "/", "http://localhost");
  if (url.pathname === "/ws/session") return { type: "session" };
  if (url.pathname.startsWith("/ws/rooms/")) {
    const roomId = decodeURIComponent(url.pathname.slice("/ws/rooms/".length));
    if (roomId.length > 0) return { type: "room", roomId };
  }
  return { type: "reject" };
}

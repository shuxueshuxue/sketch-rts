import { joinPublicPath } from "../shared/deployment-base";

export type WebSocketUpgradeRoute = { type: "room"; roomId: string } | { type: "reject" };

export function classifyWebSocketUpgrade(rawUrl: string | undefined, publicBasePath = "/"): WebSocketUpgradeRoute {
  const url = new URL(rawUrl ?? "/", "http://localhost");
  const roomPrefix = joinPublicPath(publicBasePath, "/ws/rooms/");
  if (url.pathname.startsWith(roomPrefix)) {
    const roomId = decodeURIComponent(url.pathname.slice(roomPrefix.length));
    if (roomId.length > 0) return { type: "room", roomId };
  }
  return { type: "reject" };
}

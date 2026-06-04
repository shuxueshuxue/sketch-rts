import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";

export interface NetTransport {
  send(message: ClientNetMessage): void;
  onMessage(handler: (message: ServerNetMessage) => void): void;
  close(): void;
}

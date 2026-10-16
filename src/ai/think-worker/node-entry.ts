import { parentPort, type MessagePort } from "node:worker_threads";
import { createAiThinkHost } from "./host";
import type { AiThinkMessage } from "./protocol";

// A worker thread of createAiThinkPool: each session replies on its own port and bumps its counter.
type Connect = { type: "connect"; session: string; port: MessagePort; signal: SharedArrayBuffer };
const host = createAiThinkHost();
const links = new Map<string, { port: MessagePort; signal: Int32Array }>();

parentPort!.on("message", (message: AiThinkMessage | Connect) => {
  if (message.type === "connect") {
    links.set(message.session, { port: message.port, signal: new Int32Array(message.signal) });
    return;
  }
  if (message.type === "open") {
    const link = links.get(message.session);
    if (!link) throw new Error(`AI think session ${message.session} opened before it connected`);
    host.open(message, (reply) => {
      link.port.postMessage(reply);
      Atomics.add(link.signal, 0, 1);
      Atomics.notify(link.signal, 0);
    });
    return;
  }
  if (message.type === "close") {
    host.close(message);
    links.get(message.session)?.port.close();
    links.delete(message.session);
    return;
  }
  host.think(message);
});

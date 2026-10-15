import { createAiThinkHost } from "./host";
import type { AiThinkMessage, AiThinkReply } from "./protocol";

// The Web Worker a browser match thinks on (see @@@think-thread).
const scope = globalThis as unknown as { postMessage(reply: AiThinkReply): void; onmessage: ((event: { data: AiThinkMessage }) => void) | null };
const host = createAiThinkHost();

scope.onmessage = ({ data: message }) => {
  if (message.type === "open") host.open(message, (reply) => scope.postMessage(reply));
  else if (message.type === "close") host.close(message);
  else host.think(message);
};

import { createAiThinkHost } from "./host";
import type { AiThinkMessage, AiThinkReply } from "./protocol";

// The Web Worker a browser match thinks on (see @@@think-thread). The match reaches it directly, or through a port the
// page passed on when the match runs on a thread of its own (see @@@match-thread).
type Endpoint = { postMessage(reply: AiThinkReply): void; onmessage: ((event: { data: AiThinkMessage | { type: "port"; port: Endpoint } }) => void) | null };
const scope = globalThis as unknown as Endpoint;
const host = createAiThinkHost();

function listen(endpoint: Endpoint) {
  endpoint.onmessage = ({ data: message }) => {
    if (message.type === "port") listen(message.port);
    else if (message.type === "open") host.open(message, (reply) => endpoint.postMessage(reply));
    else if (message.type === "close") host.close(message);
    else host.think(message);
  };
}

listen(scope);

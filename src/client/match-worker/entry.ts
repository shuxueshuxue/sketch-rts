import { createMatchThreadHost } from "./host";
import type { MatchThreadEvent, MatchThreadMessage } from "./protocol";

// The Web Worker a browser match runs on (see @@@match-thread).
const scope = globalThis as unknown as { postMessage(event: MatchThreadEvent): void; onmessage: ((event: { data: MatchThreadMessage }) => void) | null };
const host = createMatchThreadHost((event) => scope.postMessage(event));
scope.onmessage = ({ data }) => host.handle(data);

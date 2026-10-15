import type { AiRuntimeState, AiThinkExecutor } from "../ai/runtime";
import { createAiThinkClientExecutor } from "../ai/think-worker/client";
import type { AiThinkReply } from "../ai/think-worker/protocol";
import type { Game } from "../shared/sim";

let nextSession = 0;

/** A browser match thinks on its own Web Worker, off the page's render thread (see @@@think-thread). */
export function createBrowserAiThinkExecutor(runtime: AiRuntimeState, game: Game): AiThinkExecutor {
  const worker = new Worker(new URL("../ai/think-worker/browser-entry.ts", import.meta.url), { type: "module" });
  const inbox: AiThinkReply[] = [];
  let fault: string | undefined;
  worker.onmessage = (event: MessageEvent<AiThinkReply>) => { inbox.push(event.data); };
  worker.onerror = (event) => { fault = event.message || "AI think worker failed"; };
  return createAiThinkClientExecutor(runtime, game, {
    send: (message) => worker.postMessage(message),
    drain: () => {
      if (fault) throw new Error(fault);
      return inbox.splice(0);
    },
    close: () => worker.terminate(),
  }, `browser-${nextSession++}`);
}

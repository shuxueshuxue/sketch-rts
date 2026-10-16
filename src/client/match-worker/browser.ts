import type { MatchThreadPort } from "./adapter";

export type MatchThreads = {
  port: MatchThreadPort;
  // The port of the match's AI thread, handed to the match thread (see @@@think-thread).
  aiPort?: MessagePort;
  terminate(): void;
};

export type MatchThreadFactory = (options: { ai: boolean }) => MatchThreads;

/** A match thread for one browser match and, when it has AI players, an AI thread wired straight to it. */
export const createBrowserMatchThreads: MatchThreadFactory = ({ ai }) => {
  const match = new Worker(new URL("./entry.ts", import.meta.url), { type: "module" });
  const port = match as unknown as MatchThreadPort;
  if (!ai) return { port, terminate: () => match.terminate() };
  const thinking = new Worker(new URL("../../ai/think-worker/browser-entry.ts", import.meta.url), { type: "module" });
  const { port1, port2 } = new MessageChannel();
  thinking.postMessage({ type: "port", port: port1 }, [port1]);
  return { port, aiPort: port2, terminate: () => { match.terminate(); thinking.terminate(); } };
};

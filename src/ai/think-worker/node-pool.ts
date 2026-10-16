import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import type { Game } from "../../shared/sim";
import type { AiRuntimeState, AiThinkExecutor } from "../runtime";
import { createAiThinkClientExecutor, type AiThinkChannel } from "./client";
import type { AiThinkReply } from "./protocol";

export type AiThinkPoolOptions = {
  // The worker entry (node-entry.ts, or its bundled copy).
  workerUrl: URL;
  threads?: number;
  // Node options for the threads (a test loads the TypeScript entry with a loader); this process's own by default.
  execArgv?: string[];
};

/**
 * Worker threads shared by every hosted match; each match is one session on one of them (see @@@think-thread). Replies
 * come back on the session's own port with a shared counter, so a match can poll them while it ticks live, and a
 * synchronous fast-forward can block on the counter until its think has arrived.
 */
export function createAiThinkPool(options: AiThinkPoolOptions) {
  const threads = Math.max(1, options.threads ?? 1);
  const workers: Worker[] = [];
  let nextWorker = 0;
  let nextSession = 0;
  const pick = () => {
    if (workers.length < threads) {
      const worker = new Worker(options.workerUrl, options.execArgv ? { execArgv: options.execArgv } : {});
      // A pool must not keep a finished process (a test, a script) alive.
      worker.unref();
      worker.on("error", (error) => { console.error("AI think thread failed", error); });
      workers.push(worker);
      return worker;
    }
    const worker = workers[nextWorker % workers.length]!;
    nextWorker += 1;
    return worker;
  };
  return {
    executor(runtime: AiRuntimeState, game: Game): AiThinkExecutor {
      const worker = pick();
      const { port1, port2 } = new MessageChannel();
      port1.unref();
      const signal = new Int32Array(new SharedArrayBuffer(4));
      const session = `think-${process.pid}-${nextSession++}`;
      worker.postMessage({ type: "connect", session, port: port2, signal: signal.buffer }, [port2]);
      let seen = 0;
      const channel: AiThinkChannel = {
        send: (message) => worker.postMessage(message),
        drain: () => {
          seen = Atomics.load(signal, 0);
          const replies: AiThinkReply[] = [];
          for (let received = receiveMessageOnPort(port1); received; received = receiveMessageOnPort(port1)) replies.push(received.message as AiThinkReply);
          return replies;
        },
        wait: (timeoutMs) => { Atomics.wait(signal, 0, seen, timeoutMs); },
        close: () => port1.close(),
      };
      return createAiThinkClientExecutor(runtime, game, channel, session);
    },
    async close() {
      await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
    },
  };
}

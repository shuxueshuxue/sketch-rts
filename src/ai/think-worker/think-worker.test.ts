import { AiPlanObserver } from '../plan-observer';
import type { AiPlanPacket } from '../plan-stream';
import { afterAll, describe, expect, it } from "vitest";
import { createGame } from "../../shared/sim";
import { checksumGame } from "../../shared/sim/checksum";
import { CommandFrameRuntime } from "../../shared/sim/command-frame-runtime";
import type { CommandFrame } from "../../shared/net/types";
import { createAiRuntime, createPresetAiRuntimeFramePlanner, type AiRuntimeState, type AiThinkExecutorFactory } from "../runtime";
import { createAiThinkClientExecutor } from "./client";
import { createAiThinkHost } from "./host";
import { createAiThinkPool } from "./node-pool";
import type { AiThinkMessage, AiThinkReply } from "./protocol";
import type { Game } from "../../shared/sim";
import { PLANNER_COMMAND_DELAY_TICKS } from "../../shared/sim/planner-schedule";
import { groundRegionIndex } from "../../shared/terrain";

const TICKS = 600;

function playMatch(executor?: AiThinkExecutorFactory) {
  const game = createGame("bareDuel", { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } });
  const ai = createAiRuntime(["player", "enemy"]);
  const thinking = executor?.(ai, game);
  const runtime = new CommandFrameRuntime({ game, roomId: "think-thread", rejectionLabel: "Think thread rejected", aiPlanner: createPresetAiRuntimeFramePlanner(game, ai, thinking ? { executor: thinking } : {}) });
  const frames: CommandFrame[] = [];
  for (let tick = 0; tick < TICKS && !game.match.winner; tick += 1) {
    // Settled, as a synchronous driver steps a match: every think lands on its due tick, wherever it ran.
    const frame = runtime.tick([], { settleAi: true });
    if (frame) frames.push(frame);
  }
  thinking?.close?.();
  return { frames, checksum: checksumGame(game), tick: game.tick };
}

// A thread of its own in all but the thread: every message is copied as postMessage copies it.
const copiedHost: AiThinkExecutorFactory = (runtime, game) => {
  const host = createAiThinkHost();
  const inbox: AiThinkReply[] = [];
  return createAiThinkClientExecutor(runtime, game, {
    send(message) {
      const copy = structuredClone(message);
      if (copy.type === "open") host.open(copy, (reply) => inbox.push(structuredClone(reply)));
      else if (copy.type === "close") host.close(copy);
      else host.think(copy);
    },
    drain: () => inbox.splice(0),
    close() {},
  }, "copied");
};

const pool = createAiThinkPool({ workerUrl: new URL("./node-entry.ts", import.meta.url), execArgv: ["--import", "tsx"] });
afterAll(() => pool.close());

describe("AI think thread", () => {
  const inline = playMatch();

  it("prepares the worker's own static geography when its room opens, before any think", () => {
    const map = structuredClone(createGame("sapphireArchipelago", { aiPlayers: [] }).map);
    expect(groundRegionIndex(map, 0).scannedRows).toBe(0);
    const before = JSON.stringify(map), host = createAiThinkHost(), replies: AiThinkReply[] = [];
    host.open({ type: "open", session: "static-geography", map }, reply => replies.push(reply));
    expect(groundRegionIndex(map, 0).scannedRows).toBe(map.terrain!.rows);
    expect(JSON.stringify(map)).toBe(before);
    expect(replies).toEqual([]);
    host.close({ type: "close", session: "static-geography" });
  });

  it("plays the same match when every think crosses as a copied message", () => {
    expect(inline.frames.length).toBeGreaterThan(10);
    expect(playMatch(copiedHost)).toEqual(inline);
  });

  it("plays the same match with its thinks on a worker thread", () => {
    expect(playMatch(pool.executor)).toEqual(inline);
  }, 60_000);

  it("preserves every delivered command with incremental observation crossing both thread boundaries", () => {
    const packets: AiPlanPacket[] = [];
    const observed: AiThinkExecutorFactory = (runtime, game) => {
      const executor = copiedHost(runtime, game);
      const observer = new AiPlanObserver(game, runtime.controlledPlayers, executor);
      observer.subscribe(packet => packets.push(packet));
      const close = executor.close;
      executor.close = () => { observer.dispose(); close?.(); };
      return executor;
    };
    expect(playMatch(observed)).toEqual(inline);
    expect(packets.some(p => p.type === 'trace' && p.baseTick !== null)).toBe(true);
  });

  it("lands a think that arrives late on the first tick after it arrives, and waits for it only when settling", () => {
    // A thinking thread that answers only when let: thinks wait in its inbox until `answer` runs them.
    const host = createAiThinkHost();
    const inbox: AiThinkReply[] = [], pending: AiThinkMessage[] = [];
    const answer = () => { for (const message of pending.splice(0)) if (message.type === "think") host.think(message); };
    const executor = (wait?: () => void) => (runtime: AiRuntimeState, game: Game) => createAiThinkClientExecutor(runtime, game, {
      send(message) {
        const copy = structuredClone(message);
        if (copy.type === "open") host.open(copy, (reply) => inbox.push(structuredClone(reply)));
        else if (copy.type === "think") pending.push(copy);
      },
      drain: () => inbox.splice(0),
      ...(wait ? { wait } : {}),
      close() {},
    }, "late");
    const start = (factory: AiThinkExecutorFactory) => {
      const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
      const ai = createAiRuntime(["enemy"]), thinking = factory(ai, game);
      return { game, thinking, runtime: new CommandFrameRuntime({ game, roomId: "late", rejectionLabel: "Late think rejected", aiPlanner: createPresetAiRuntimeFramePlanner(game, ai, { executor: thinking }) }) };
    };

    const live = start(executor());
    const frames = Array.from({ length: PLANNER_COMMAND_DELAY_TICKS + 3 }, () => live.runtime.tick());
    expect(frames.every((frame) => frame === undefined)).toBe(true);
    answer();
    expect(live.runtime.tick()).toMatchObject({ tick: PLANNER_COMMAND_DELAY_TICKS + 3, commands: expect.arrayContaining([expect.objectContaining({ playerId: "enemy" })]) });
    // The readout's account of it: one think, landed three ticks late; no turn skipped yet (the next is tick 15).
    expect(live.thinking.report!()).toMatchObject({ thinks: 1, late: 1, lateTicks: 3, skipped: 0 });
    expect(live.thinking.report!()).toMatchObject({ thinks: 0, late: 0 });

    const settled = start(executor(answer));
    const due = Array.from({ length: PLANNER_COMMAND_DELAY_TICKS + 1 }, () => settled.runtime.tick([], { settleAi: true }));
    expect(due.slice(0, PLANNER_COMMAND_DELAY_TICKS)).toEqual(Array(PLANNER_COMMAND_DELAY_TICKS).fill(undefined));
    expect(due[PLANNER_COMMAND_DELAY_TICKS]).toMatchObject({ tick: PLANNER_COMMAND_DELAY_TICKS });
  });

  it("refuses scripts given as functions instead of thinking without them", () => {
    const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const ai = createAiRuntime(["enemy"], { scripts: [{ id: "local-only", phase: "economy", run: () => undefined }] });
    expect(() => copiedHost(ai, game)).toThrow(/scripts given as functions/);
  });
});

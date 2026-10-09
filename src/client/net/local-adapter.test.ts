import { describe, expect, it, vi } from "vitest";
import type { AiScript } from "../../ai/policy";
import { createAiRuntime } from "../../ai/runtime";
import { createGame } from "../../shared/sim";
import { createRoom } from '../../shared/rooms';
import { LocalGameAdapter } from "./local-adapter";

describe("local game adapter", () => {
  it('shares the current snapshot between frames and replaces it after commands or simulation advance', () => {
    let now = 0;
    const game = createGame('bareDuel', {aiPlayers: []}), adapter = new LocalGameAdapter(game, 'player', {now: () => now});
    const initial = adapter.currentSnapshot(), worker = initial.units.find(unit => unit.owner === 'player' && unit.kind === 'worker')!;
    expect(adapter.currentSnapshot()).toBe(initial);expect(adapter.updateToRenderTime()).toBe(false);
    expect(adapter.currentSnapshot()).toBe(initial);
    adapter.sendCommand({type: 'move', unitIds: [worker.id], x: worker.x + 100, y: worker.y});
    const commanded = adapter.currentSnapshot();
    expect(commanded).not.toBe(initial);expect(commanded.tick).toBe(1);expect(initial.tick).toBe(0);
    expect(initial.units.find(unit => unit.id === worker.id)!.order.type).toBe('idle');
    expect(adapter.currentSnapshot()).toBe(commanded);
    now = 50;expect(adapter.updateToRenderTime()).toBe(true);
    const advanced = adapter.currentSnapshot();expect(advanced).not.toBe(commanded);
    expect(advanced.tick).toBe(2);expect(commanded.tick).toBe(1);
  });
  it('closes once and stops both command and render-time simulation', () => {
    let now = 0;
    const game = createGame('bareDuel', {aiPlayers: []}), onClose = vi.fn();
    const adapter = new LocalGameAdapter(game, 'player', {now: () => now, onClose});
    const worker = game.units.find(unit => unit.owner === 'player' && unit.kind === 'worker')!;
    adapter.close();adapter.close();now = 1000;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(adapter.updateToRenderTime()).toBe(false);
    expect(() => adapter.sendCommand({type: 'move', unitIds: [worker.id], x: worker.x + 100, y: worker.y})).toThrow('Local match is closed');
    expect(game.tick).toBe(0);
  });
  it('allows the owner to release a naturally completed match before returning its result', () => {
    let now = 0;
    const game = createGame('bareDuel', {aiPlayers: []});
    game.buildings = game.buildings.filter(building => building.owner === 'player');
    const room = {...createRoom({id: 'finish', host: {id: 'host', name: 'Host'}, mapId: 'bareDuel'}), status: 'inMatch' as const};
    const onClose = vi.fn(), finishRoom = vi.fn(() => ({...room, status: 'ended' as const}));
    const onRoomEnded = vi.fn(() => adapter.close());
    const adapter = new LocalGameAdapter(game, 'player', {now: () => now, room, finishRoom, onRoomEnded, onClose});
    now = 200;expect(adapter.updateToRenderTime()).toBe(true);
    expect(finishRoom).toHaveBeenCalledTimes(1);expect(onRoomEnded).toHaveBeenCalledTimes(1);expect(onClose).toHaveBeenCalledTimes(1);
    now = 1000;expect(adapter.updateToRenderTime()).toBe(false);expect(game.tick).toBe(1);
  });
  it('resumes a background tab without repaying minutes of simulation in one render', () => {
    let now = 0;
    const game = createGame('bareDuel', {aiPlayers:[]});
    const adapter = new LocalGameAdapter(game,'player',{now:()=>now});
    now = 10 * 60 * 1000;
    expect(adapter.updateToRenderTime()).toBe(true);
    expect(game.tick).toBeGreaterThan(0);
    expect(game.tick).toBeLessThanOrEqual(4);
    const resumed = game.tick;
    now += 50;
    adapter.updateToRenderTime();
    expect(game.tick - resumed).toBeLessThanOrEqual(4);
  });
  it("applies local commands through command frames before stepping simulation", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const adapter = new LocalGameAdapter(game, "player");

    adapter.sendCommand({ type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y });

    expect(adapter.currentSnapshot().tick).toBe(1);
    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("advances render-time ticks even when no player command is sent", () => {
    let now = 0;
    const game = createGame("bareDuel", { aiPlayers: [] });
    const adapter = new LocalGameAdapter(game, "player", { now: () => now, tickMs: 50 });

    now = 160;

    expect(adapter.updateToRenderTime()).toBe(true);
    expect(adapter.currentSnapshot().tick).toBe(3);
  });

  it("rejects invalid local player commands before stepping simulation", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(townHall).toBeDefined();
    const adapter = new LocalGameAdapter(game, "player");

    expect(() => adapter.sendCommand({ type: "train", buildingId: townHall!.id, unitKind: "footman" })).toThrow(/Local command rejected: townHall cannot train footman/);
    expect(adapter.currentSnapshot().tick).toBe(0);
    expect(townHall!.queue).toHaveLength(0);
  });

  it("does not consume an AI think cycle when a local player command is rejected", () => {
    const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(townHall).toBeDefined();
    const aiRuntime = createAiRuntime(["enemy"]);
    const beforeThink = aiRuntime.lastThink.enemy;
    const adapter = new LocalGameAdapter(game, "player", { aiRuntime });

    expect(() => adapter.sendCommand({ type: "train", buildingId: townHall!.id, unitKind: "footman" })).toThrow(/Local command rejected: townHall cannot train footman/);

    expect(adapter.currentSnapshot().tick).toBe(0);
    expect(aiRuntime.lastThink.enemy).toBe(beforeThink);
  });

  it("does not consume an AI think cycle when a local AI command is rejected", () => {
    let now = 0;
    const invalidScript: AiScript = {
      id: "invalid-local-ai-command",
      phase: "economy",
      run(snapshot, owner) {
        const townHall = snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall");
        expect(townHall).toBeDefined();
        return { type: "train", buildingId: townHall!.id, unitKind: "footman" };
      },
    };
    const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const aiRuntime = createAiRuntime(["enemy"], { scripts: [invalidScript] });
    const beforeThink = aiRuntime.lastThink.enemy;
    const adapter = new LocalGameAdapter(game, "player", { aiRuntime, now: () => now, tickMs: 50 });
    now = 50;

    expect(() => adapter.updateToRenderTime()).toThrow(/Local command rejected: townHall cannot train footman/);

    expect(adapter.currentSnapshot().tick).toBe(0);
    expect(aiRuntime.lastThink.enemy).toBe(beforeThink);
  });

  it("keeps stale local command issuers from rejecting live issuer subsets", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const workers = game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker").slice(0, 2);
    expect(workers).toHaveLength(2);
    game.units = game.units.filter((unit) => unit.id !== workers[1]!.id);
    const adapter = new LocalGameAdapter(game, "player");

    expect(() => adapter.sendCommand({ type: "move", unitIds: workers.map((worker) => worker.id), x: workers[0]!.x + 80, y: workers[0]!.y })).not.toThrow();

    expect(adapter.currentSnapshot().tick).toBe(1);
    expect(game.units.find((unit) => unit.id === workers[0]!.id)?.order).toMatchObject({ type: "move" });
  });
});

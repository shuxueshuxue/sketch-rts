import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setScratchCanvasFactory } from "./art/scratch-canvas";
import { UnitFacingTracker } from "./unit-facing";
import { drawWorld, ownerInk, trackUnitFacing, type WorldFrame } from "./world-renderer";
import { sketchScene } from "../sdk/scene";
import { snapshotGame } from "../shared/sim";
import type { GameSnapshot } from "../shared/types";

type Call = { name: string; args: unknown[] };
type Transform = { a: number; b: number; c: number; d: number; e: number; f: number };

// A 2D context that records every call; it keeps only the transform, which the atlas reads for sprite resolution.
function recordingContext() {
  const calls: Call[] = [];
  let transform: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: Transform[] = [];
  const gradient = () => ({ addColorStop() {} });
  const methods: Record<string, (...args: never[]) => unknown> = {
    save: () => void stack.push({ ...transform }),
    restore: () => void (transform = stack.pop() ?? transform),
    scale: (x: number, y: number) => void (transform = { ...transform, a: transform.a * x, b: transform.b * x, c: transform.c * y, d: transform.d * y }),
    translate: (x: number, y: number) => void (transform = { ...transform, e: transform.e + transform.a * x + transform.c * y, f: transform.f + transform.b * x + transform.d * y }),
    getTransform: () => ({ ...transform }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: () => ({ width: 0 }),
  };
  const state: Record<string, unknown> = { globalAlpha: 1, strokeStyle: "#000", fillStyle: "#000", lineWidth: 1, font: "10px sans-serif", textAlign: "start", lineCap: "butt", lineJoin: "miter", shadowBlur: 0, shadowColor: "transparent" };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      const method = methods[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        return method?.(...(args as never[]));
      };
    },
    set(target, key, value) {
      if (typeof key === "string") target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function fakeCanvas(width: number, height: number) {
  return { width, height, getContext: () => recordingContext().ctx } as unknown as HTMLCanvasElement;
}

// Sprites are drawn scaled into a box (five arguments); the paper ground tiles are drawn as they are (three).
function spriteDraws(calls: Call[]) {
  return calls.filter((call) => call.name === "drawImage" && call.args.length === 5);
}

function duelSnapshot(options: { northX?: number; southX?: number; campStock?: number; cloak?: boolean } = {}): GameSnapshot {
  const scene = sketchScene("renderer")
    .map("bareDuel")
    .replaceDefaults()
    .player("north", { team: "north", race: "grove" })
    .player("south", { team: "south", race: "ember" })
    .unit("north", "footman", options.northX ?? 300, 300, { id: "north-footman" })
    .unit("south", "footman", options.southX ?? 200, 300, { id: "south-footman", order: { type: "attack", targetId: "north-footman" } });
  if (options.campStock !== undefined) scene.mercenaryCamp("camp", 500, 420, { stock: options.campStock });
  if (options.cloak) scene.item("cloak", "flameCloak", 300, 300, { carrierId: "north-footman" });
  return snapshotGame(scene.build().createGame());
}

function frame(snapshot: GameSnapshot, overrides: Partial<WorldFrame> = {}): WorldFrame & { calls: Call[] } {
  const { ctx, calls } = recordingContext();
  return {
    ctx,
    calls,
    snapshot,
    view: { x: 0, y: 0, width: 800, height: 600 },
    now: 1000,
    facing: new UnitFacingTracker(),
    labels: { mercenaryStock: (stock) => `stock:${stock}`, unitKind: (kind) => `kind:${kind}` },
    ...overrides,
  };
}

describe("world renderer", () => {
  beforeEach(() => setScratchCanvasFactory(fakeCanvas));
  afterEach(() => setScratchCanvasFactory(undefined));

  it("draws every unit in view through the atlas and mirrors one that faces left", () => {
    // south attacks north from the left, so it faces right; north has never moved and faces right too.
    const facingRight = frame(duelSnapshot({ northX: 300, southX: 200 }));
    drawWorld(facingRight);
    expect(spriteDraws(facingRight.calls)).toHaveLength(2);
    expect(facingRight.calls.filter((call) => call.name === "scale" && call.args[0] === -1)).toHaveLength(0);

    // Now south attacks from the right: it turns to face left and its sprite is drawn mirrored.
    const facingLeft = frame(duelSnapshot({ northX: 200, southX: 300 }));
    drawWorld(facingLeft);
    expect(facingLeft.facing.facing("south-footman")).toBe(-1);
    expect(spriteDraws(facingLeft.calls)).toHaveLength(2);
    expect(facingLeft.calls.filter((call) => call.name === "scale" && call.args[0] === -1 && call.args[1] === 1)).toHaveLength(1);
  });

  it("leaves out units outside the view", () => {
    const view = frame(duelSnapshot({ northX: 300, southX: 2000 }));
    drawWorld(view);
    expect(spriteDraws(view.calls)).toHaveLength(1);
  });

  it("zooms the whole frame and covers correspondingly less of the world", () => {
    const snapshot = duelSnapshot({ northX: 300, southX: 700 });
    const flat = frame(snapshot);
    drawWorld(flat);
    expect(spriteDraws(flat.calls)).toHaveLength(2);

    const zoomed = frame(snapshot, { view: { x: 0, y: 0, width: 800, height: 600, zoom: 2 } });
    drawWorld(zoomed);
    expect(zoomed.calls[0]).toEqual({ name: "save", args: [] });
    expect(zoomed.calls[1]).toEqual({ name: "scale", args: [2, 2] });
    expect(zoomed.calls.at(-1)).toEqual({ name: "restore", args: [] });
    // At zoom 2 an 800-pixel view spans 400 world units: the unit at x=700 is out of it.
    expect(spriteDraws(zoomed.calls)).toHaveLength(1);
  });

  it("follows the camera: the world point at the view's corner lands at the canvas origin", () => {
    const view = frame(duelSnapshot({ northX: 1300, southX: 1200 }), { view: { x: 1000, y: 100, width: 800, height: 600 } });
    drawWorld(view);
    const draws = spriteDraws(view.calls);
    expect(draws).toHaveLength(2);
    // Sprites are 128 world units square at glyph scale 1, drawn centred on the unit.
    const lefts = draws.map((call) => call.args[1] as number).sort((a, b) => a - b);
    const width = draws[0]!.args[3] as number;
    expect(lefts.map((left) => left + width / 2)).toEqual([200, 300]);
  });

  it("animates from the frame clock, never the wall clock", () => {
    const wallClock = vi.spyOn(performance, "now");
    const snapshot = duelSnapshot({ cloak: true });
    const first = frame(snapshot, { now: 500 });
    const again = frame(snapshot, { now: 500 });
    const later = frame(snapshot, { now: 900 });
    drawWorld(first);
    drawWorld(again);
    drawWorld(later);
    expect(wallClock).not.toHaveBeenCalled();
    expect(again.calls).toEqual(first.calls);
    expect(later.calls).not.toEqual(first.calls);
    wallClock.mockRestore();
  });

  it("paints the caller's words into the world", () => {
    const view = frame(duelSnapshot({ campStock: 3 }));
    drawWorld(view);
    expect(view.calls.some((call) => call.name === "fillText" && call.args[0] === "stock:3")).toBe(true);
  });

  it("tracks facing idempotently, so extra updates between drawn frames change nothing", () => {
    const snapshot = duelSnapshot({ northX: 200, southX: 300 });
    const once = new UnitFacingTracker();
    const twice = new UnitFacingTracker();
    trackUnitFacing(once, snapshot);
    trackUnitFacing(twice, snapshot);
    trackUnitFacing(twice, snapshot);
    expect(twice.facing("south-footman")).toBe(once.facing("south-footman"));
    expect(once.facing("south-footman")).toBe(-1);
  });

  it("inks the two default seats and neutrals in fixed colours and any other owner from one palette", () => {
    expect(ownerInk("player")).toBe("#387d72");
    expect(ownerInk("enemy")).toBe("#a85644");
    expect(ownerInk("neutral")).toBe("#704a33");
    expect(ownerInk("north")).toBe(ownerInk("north"));
    expect(ownerInk("north")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

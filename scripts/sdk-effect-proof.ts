import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { SketchRtsBrowserDebug } from "../src/sdk/browser";
import { SketchRtsSdk } from "../src/sdk/client";
import type { GameCommand, GameSetupOptions, LocalUserProfile, WorldEffect } from "../src/shared/types";

const port = Number(process.env.PORT ?? 34573);
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const proofDir = process.env.PROOF_DIR ?? path.join(homedir(), "share", "ops", "sketch-rts-yatu", "sdk-effect-proof");
const session = `se-${Date.now().toString(36)}`;
const playwrightCli = process.env.PLAYWRIGHT_CLI ?? "playwright-cli";
const host: LocalUserProfile = { id: "sdk-effect-proof-user", name: "SDK Effect Proof" };
const roomId = `sdk-effect-proof-${Date.now().toString(36)}`;

mkdirSync(proofDir, { recursive: true });

async function main() {
  const sdk = new SketchRtsSdk(baseUrl, connectionCloseFetch);
  const page = new PlaywrightCliPage(session, playwrightCli);
  const browser = new SketchRtsBrowserDebug(sdk, page);
  let roomCreated = false;
  try {
    page.open(baseUrl);
    await sdk.createRoom({ id: roomId, host, name: "SDK Effect Proof Room", mapId: "bareDuel", humanCount: 1, aiCount: 1, visibility: "private" });
    roomCreated = true;
    await sdk.startRoom(roomId);
    await sdk.pauseRoom(roomId);

    const results = [];
    for (const scene of scenes()) {
      await sdk.resetRoom(roomId, "bareDuel", { aiPlayers: [], scenario: scene.scenario });
      if (scene.command) await sdk.roomCommand(roomId, "player", scene.command);
      if (scene.ticks) await sdk.tickRoom(roomId, scene.ticks);
      const shot = await browser.captureRoomEffectScreenshot({
        roomId,
        effectType: scene.effectType,
        path: path.join(proofDir, `sdk-effect-${scene.name}.png`),
        width: 1600,
        height: 1000,
        user: host,
        hidePointerLockGate: true,
        maxTicks: 80,
      });
      results.push({ name: scene.name, effect: shot.effect.type, path: shot.path });
    }

    process.stdout.write(`${JSON.stringify({ baseUrl, roomId, proofDir, results }, null, 2)}\n`);
  } finally {
    if (roomCreated) {
      try {
        await sdk.closeRoom(roomId, host.id);
      } catch (error) {
        process.stderr.write(`Could not close proof room: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    page.close();
  }
}

const connectionCloseFetch: typeof fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("Connection", "close");
  return fetch(input, { ...init, headers });
};

type EffectProofScene = {
  name: string;
  effectType: WorldEffect["type"];
  scenario: NonNullable<GameSetupOptions["scenario"]>;
  command?: GameCommand;
  ticks?: number;
};

function scenes(): EffectProofScene[] {
  const baseScenario = {
    replaceDefaultUnits: true,
    replaceDefaultBuildings: true,
    replaceDefaultResources: true,
    replaceDefaultMercenaryCamps: true,
    replaceDefaultLandmarks: false,
  } satisfies NonNullable<GameSetupOptions["scenario"]>;
  return [
    {
      name: "lightning-rod",
      effectType: "chainLightning",
      scenario: {
        ...baseScenario,
        addUnits: [
          { id: "caster", owner: "player", kind: "archer", x: 1080, y: 980 },
          { id: "target-a", owner: "enemy", kind: "footman", x: 1280, y: 980 },
          { id: "target-b", owner: "enemy", kind: "archer", x: 1395, y: 1030 },
        ],
        addItems: [{ id: "lightning-rod", kind: "lightningRod", x: 0, y: 0, carrierId: "caster", cooldownRemaining: 0 }],
      },
      command: { type: "useItem", unitId: "caster", itemId: "lightning-rod", targetId: "target-a" },
    },
    {
      name: "storm-staff",
      effectType: "storm",
      scenario: {
        ...baseScenario,
        addUnits: [
          { id: "caster", owner: "player", kind: "archer", x: 1080, y: 980 },
          { id: "target-a", owner: "enemy", kind: "footman", x: 1280, y: 980 },
          { id: "target-b", owner: "enemy", kind: "archer", x: 1315, y: 1025 },
        ],
        addItems: [{ id: "storm-staff", kind: "stormStaff", x: 0, y: 0, carrierId: "caster", cooldownRemaining: 0 }],
      },
      command: { type: "useItem", unitId: "caster", itemId: "storm-staff", x: 1290, y: 995 },
    },
    {
      name: "guardian-scroll",
      effectType: "guardianField",
      scenario: {
        ...baseScenario,
        addUnits: [
          { id: "caster", owner: "player", kind: "footman", x: 1180, y: 1005 },
          { id: "ally-a", owner: "player", kind: "archer", x: 1250, y: 980 },
          { id: "ally-b", owner: "player", kind: "priest", x: 1120, y: 1025 },
        ],
        addItems: [{ id: "guardian-scroll", kind: "guardianScroll", x: 0, y: 0, carrierId: "caster", cooldownRemaining: 0 }],
      },
      command: { type: "useItem", unitId: "caster", itemId: "guardian-scroll" },
    },
    {
      name: "experience-book",
      effectType: "experienceBurst",
      scenario: {
        ...baseScenario,
        addUnits: [{ id: "caster", owner: "player", kind: "footman", x: 1180, y: 1005 }],
        addItems: [{ id: "experience-book", kind: "experienceBook", x: 0, y: 0, carrierId: "caster", cooldownRemaining: 0 }],
      },
      command: { type: "useItem", unitId: "caster", itemId: "experience-book" },
    },
    {
      name: "unit-level-up",
      effectType: "levelUp",
      scenario: {
        ...baseScenario,
        addUnits: [{ id: "caster", owner: "player", kind: "footman", x: 1180, y: 1005 }],
        addItems: [{ id: "experience-book", kind: "experienceBook", x: 0, y: 0, carrierId: "caster", cooldownRemaining: 0 }],
      },
      command: { type: "useItem", unitId: "caster", itemId: "experience-book" },
    },
    {
      name: "flame-cloak",
      effectType: "flameBurn",
      scenario: {
        ...baseScenario,
        addUnits: [
          { id: "caster", owner: "player", kind: "footman", x: 1180, y: 1005 },
          { id: "target-a", owner: "enemy", kind: "footman", x: 1235, y: 1005 },
        ],
        addItems: [{ id: "flame-cloak", kind: "flameCloak", x: 0, y: 0, carrierId: "caster", cooldownRemaining: 0 }],
      },
      ticks: 1,
    },
    {
      name: "heal",
      effectType: "heal",
      scenario: {
        ...baseScenario,
        addUnits: [
          { id: "caster", owner: "player", kind: "priest", x: 1080, y: 980 },
          { id: "ally", owner: "player", kind: "footman", x: 1260, y: 980, hp: 60 },
        ],
      },
      command: { type: "cast", unitId: "caster", ability: "heal", targetId: "ally" },
    },
    {
      name: "summon",
      effectType: "summon",
      scenario: {
        ...baseScenario,
        addUnits: [{ id: "caster", owner: "player", kind: "summoner", x: 1080, y: 980 }],
      },
      command: { type: "cast", unitId: "caster", ability: "summon", x: 1265, y: 995 },
    },
    {
      name: "curse",
      effectType: "curse",
      scenario: {
        ...baseScenario,
        addUnits: [
          { id: "caster", owner: "player", kind: "witch", x: 1080, y: 980 },
          { id: "target", owner: "enemy", kind: "footman", x: 1285, y: 990 },
        ],
      },
      command: { type: "cast", unitId: "caster", ability: "curse", targetId: "target" },
    },
  ];
}

class PlaywrightCliPage {
  constructor(
    private readonly session: string,
    private readonly bin: string,
  ) {}

  open(url: string) {
    this.run("open", url);
  }

  close() {
    try {
      this.run("close");
    } catch {
      // Closing proof browsers is best-effort; runtime restoration above is the important cleanup.
    }
  }

  async setViewportSize(size: { width: number; height: number }) {
    this.run("resize", String(size.width), String(size.height));
  }

  async goto(url: string) {
    this.run("goto", url);
  }

  async evaluate(fn: (...args: any[]) => unknown, arg?: unknown) {
    const code = `async page => await page.evaluate(${fn.toString()}, ${JSON.stringify(arg)})`;
    this.run("run-code", code);
  }

  async reload() {
    this.run("reload");
  }

  locator(selector: string) {
    return {
      click: async () => {
        this.run("run-code", `async page => await page.locator(${JSON.stringify(selector)}).click()`);
      },
    };
  }

  async waitForSelector(selector: string, options: { timeout?: number } = {}) {
    this.run("run-code", `async page => await page.waitForSelector(${JSON.stringify(selector)}, ${JSON.stringify(options)})`);
  }

  async waitForFunction(fn: (...args: any[]) => unknown, arg?: unknown, options: { timeout?: number } = {}) {
    this.run("run-code", `async page => await page.waitForFunction(${fn.toString()}, ${JSON.stringify(arg)}, ${JSON.stringify(options)})`);
  }

  async screenshot(options: { path: string; fullPage?: boolean }) {
    const args = ["screenshot", `--filename=${options.path}`];
    if (options.fullPage) args.push("--full-page");
    this.run(...args);
  }

  private run(...args: string[]) {
    execFileSync(this.bin, [`-s=${this.session}`, ...args], { cwd: process.cwd(), stdio: "inherit" });
  }
}

await main();

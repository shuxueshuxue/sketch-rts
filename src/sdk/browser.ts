import { SketchRtsSdk } from "./client";
import type { LocalUserProfile, WorldEffect } from "../shared/types";

type BrowserPage = {
  setViewportSize(size: { width: number; height: number }): Promise<unknown>;
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  evaluate(fn: (...args: any[]) => unknown, arg?: unknown): Promise<unknown>;
  reload(options?: { waitUntil?: string }): Promise<unknown>;
  locator(selector: string): { click(): Promise<unknown> };
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForFunction(fn: (...args: any[]) => unknown, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
};

export type RoomScreenshotOptions = {
  roomId: string;
  path: string;
  width?: number;
  height?: number;
  user?: LocalUserProfile;
  hidePointerLockGate?: boolean;
  expectedTick?: number;
};

export type RoomScreenshotResult = {
  path: string;
};

export type RoomEffectScreenshotOptions = RoomScreenshotOptions & {
  effectType?: WorldEffect["type"];
  maxTicks?: number;
};

export type RoomEffectScreenshotResult = RoomScreenshotResult & {
  effect: WorldEffect;
};

export class SketchRtsBrowserDebug {
  constructor(
    private readonly sdk: SketchRtsSdk,
    private readonly page: BrowserPage,
  ) {}

  async captureRoomScreenshot(options: RoomScreenshotOptions): Promise<RoomScreenshotResult> {
    if (options.width && options.height) await this.page.setViewportSize({ width: options.width, height: options.height });
    await this.page.goto(this.sdk.serverUrl(), { waitUntil: "domcontentloaded" });
    await this.page.evaluate((user: LocalUserProfile | undefined) => {
      localStorage.setItem("sketch-rts-pointer-lock-guide-v1", "seen");
      if (user) localStorage.setItem("sketch-rts-user", JSON.stringify(user));
    }, options.user);
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.page.locator("[data-open-room-browser]").click();
    await this.page.locator(`[data-room-id="${options.roomId}"]`).click();
    await this.page.waitForSelector(".game-shell:not(.menu-open)");
    if (options.expectedTick !== undefined) {
      await this.page.waitForFunction((expectedTick: number) => (window as Window & { __sketchRtsView?: { tick?: number } }).__sketchRtsView?.tick === expectedTick, options.expectedTick, { timeout: 2_000 });
    }
    if (options.hidePointerLockGate) {
      await this.page.evaluate(() => {
        const gate = document.querySelector("[data-pointer-lock-gate]");
        if (gate instanceof HTMLElement) gate.style.display = "none";
      });
    }
    await this.page.screenshot({ path: options.path, fullPage: false });
    return { path: options.path };
  }

  async captureRoomEffectScreenshot(options: RoomEffectScreenshotOptions): Promise<RoomEffectScreenshotResult> {
    const waitOptions = {
      roomId: options.roomId,
      pause: true,
      ...(options.effectType !== undefined ? { effectType: options.effectType } : {}),
      ...(options.maxTicks !== undefined ? { maxTicks: options.maxTicks } : {}),
    };
    const { snapshot, effect } = await this.sdk.waitForRoomEffect(waitOptions);
    const shot = await this.captureRoomScreenshot({ ...options, expectedTick: snapshot.tick });
    return { ...shot, effect };
  }
}

import { describe, expect, it } from "vitest";
import { expressMountPath, joinPublicPath, normalizePublicBasePath } from "./deployment-base";

describe("deployment public base path", () => {
  it("normalizes root and subpath deployment bases", () => {
    expect(normalizePublicBasePath(undefined)).toBe("/");
    expect(normalizePublicBasePath("")).toBe("/");
    expect(normalizePublicBasePath("/")).toBe("/");
    expect(normalizePublicBasePath("sketch-rts")).toBe("/sketch-rts/");
    expect(normalizePublicBasePath("/sketch-rts")).toBe("/sketch-rts/");
    expect(normalizePublicBasePath("/games/sketch-rts/")).toBe("/games/sketch-rts/");
  });

  it("fails loudly for non-path deployment bases", () => {
    expect(() => normalizePublicBasePath("https://lexicalmathical.com/sketch-rts")).toThrow("Deployment base path must be a URL path");
    expect(() => normalizePublicBasePath("/sketch-rts?debug=1")).toThrow("Deployment base path must not include query or hash");
  });

  it("joins public paths without leaking root-only URLs", () => {
    expect(joinPublicPath("/", "/api/rooms")).toBe("/api/rooms");
    expect(joinPublicPath("/sketch-rts/", "/api/rooms")).toBe("/sketch-rts/api/rooms");
    expect(joinPublicPath("/sketch-rts/", "ws/rooms/room-1")).toBe("/sketch-rts/ws/rooms/room-1");
    expect(expressMountPath("/")).toBe("/");
    expect(expressMountPath("/sketch-rts/")).toBe("/sketch-rts");
  });
});

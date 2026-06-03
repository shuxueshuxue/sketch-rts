import { describe, expect, it } from "vitest";
import { parseDeploymentMode } from "./mode";

describe("deployment mode", () => {
  it("defaults to server mode when no deployment flag is provided", () => {
    expect(parseDeploymentMode(undefined)).toBe("server");
  });

  it("accepts explicit server and static modes", () => {
    expect(parseDeploymentMode("server")).toBe("server");
    expect(parseDeploymentMode("static")).toBe("static");
  });

  it("fails loudly for unknown modes", () => {
    expect(() => parseDeploymentMode("offline")).toThrow("Unknown deployment mode offline");
  });
});

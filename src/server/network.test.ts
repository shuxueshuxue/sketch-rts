import { describe, expect, it } from "vitest";
import { bindHostFromEnv, publicListenUrl, viteHmrPort } from "./network";

describe("server network binding", () => {
  it("keeps localhost-only binding by default", () => {
    expect(bindHostFromEnv({})).toBe("127.0.0.1");
    expect(publicListenUrl("127.0.0.1", 5173)).toBe("http://127.0.0.1:5173");
  });

  it("supports explicit LAN binding", () => {
    expect(bindHostFromEnv({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(publicListenUrl("0.0.0.0", 5173)).toBe("http://0.0.0.0:5173");
  });

  it("derives an isolated Vite HMR port from the app port", () => {
    expect(viteHmrPort(5173)).toBe(25173);
    expect(viteHmrPort(5176)).toBe(25176);
  });
});

import { describe, expect, it } from "vitest";
import { newUserId } from "./user-profile";

describe("local user profile ids", () => {
  it("uses randomUUID when the browser exposes it", () => {
    expect(newUserId({ randomUUID: () => "uuid-1" })).toBe("user-uuid-1");
  });

  it("falls back to getRandomValues for LAN HTTP browsers without randomUUID", () => {
    let next = 0;
    const id = newUserId({
      getRandomValues(array) {
        const bytes = array as unknown as Uint8Array;
        for (const key of Object.keys(bytes)) {
          bytes[Number(key)] = next;
          next += 1;
        }
        return array;
      },
    });

    expect(id).toBe("user-00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("fails loudly when no browser crypto source exists", () => {
    expect(() => newUserId({})).toThrow("Browser crypto random values are unavailable");
  });
});

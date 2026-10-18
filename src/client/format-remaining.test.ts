import { describe, expect, it } from "vitest";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import { formatRemaining } from "./format-remaining";

const at = (seconds: number) => formatRemaining(seconds * SIM_TICKS_PER_SECOND);

describe("formatRemaining (see @@@format-remaining)", () => {
  it("writes each range at its own precision, rounding up before choosing the range", () => {
    expect(at(0.05)).toBe("0.1s");
    expect(at(1)).toBe("1s");
    expect(at(2.4)).toBe("2.4s");
    expect(at(2.99)).toBe("3s");
    expect(at(3)).toBe("3s");
    expect(at(12.2)).toBe("13s");
    expect(at(59.9)).toBe("1:00");
    expect(at(60)).toBe("1:00");
    expect(at(65)).toBe("1:05");
    expect(at(125.5)).toBe("2:06");
  });
  it("writes nothing when no time is left", () => {
    expect(formatRemaining(0)).toBe("");
    expect(formatRemaining(-3)).toBe("");
    expect(formatRemaining(Infinity)).toBe("");
  });
});

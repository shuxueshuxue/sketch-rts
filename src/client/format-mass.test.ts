import { expect, it } from "vitest";
import { formatMass } from "./format-mass";

it("keeps scaled hull capacities and mounted payloads readable", () => {
  expect(formatMass(1800 * 1.1 ** 2)).toBe("2178");
  expect(formatMass(284.29999999999995)).toBe("284.3");
  expect(formatMass(100 + 1 / 3)).toBe("100.3");
  expect(formatMass(0)).toBe("0");
});

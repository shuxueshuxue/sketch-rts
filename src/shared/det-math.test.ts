import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { detCos, detSin } from "./det-math";

// Float64 bits, big-endian hex.
function bits(x: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

function digest(xs: number[]) {
  const hash = createHash("sha1");
  for (const x of xs) hash.update(bits(detSin(x)) + bits(detCos(x)));
  return hash.digest("hex").slice(0, 16);
}

// Expected bits recorded on mac1 (node 26, arm64) and checked identical on the A100 (node 22, x64): these functions
// must give them on every platform. [input, bits of the input, bits of sin, bits of cos].
const CASES: [number, string, string, string][] = [
  [0, "0000000000000000", "0000000000000000", "3ff0000000000000"],
  [-0, "8000000000000000", "8000000000000000", "3ff0000000000000"],
  [1e-10, "3ddb7cdfd9d7bdbb", "3ddb7cdfd9d7bdbb", "3ff0000000000000"],
  [0.5, "3fe0000000000000", "3fdeaee8744b05f0", "3fec1528065b7d50"],
  [Math.PI / 4, "3fe921fb54442d18", "3fe6a09e667f3bcc", "3fe6a09e667f3bcd"],
  [1, "3ff0000000000000", "3feaed548f090cee", "3fe14a280fb5068c"],
  [-1, "bff0000000000000", "bfeaed548f090cee", "3fe14a280fb5068c"],
  [2, "4000000000000000", "3fed18f6ead1b446", "bfdaa22657537205"],
  [3, "4008000000000000", "3fc210386db6d55b", "bfefae04be85e5d2"],
  [Math.PI, "400921fb54442d18", "3ca1a62633145c07", "bff0000000000000"],
  [2 * Math.PI, "401921fb54442d18", "bcb1a62633145c07", "3ff0000000000000"],
  [-Math.PI / 2, "bff921fb54442d18", "bff0000000000000", "3c91a62633145c07"],
  [10, "4024000000000000", "bfe1689ef5f34f52", "bfead9ac890c6b1f"],
  [-100, "c059000000000000", "3fe03425b78c4db8", "3feb981dbf665fdf"],
  [1000, "408f400000000000", "3fea75cc150a206b", "3fe1ff026793f1bc"],
  [12345.678, "40c81cd6c8b43958", "bfe687d5890974a5", "3fe6b94c3bbe24b8"],
  [800000, "41286a0000000000", "bfd20f02e8178612", "3feeb31f58234b5e"],
  [(Math.PI / 2) * 1e5, "41032cbd0fba43a7", "bdb2ab89826c3c3b", "3ff0000000000000"],
  [(Math.PI / 2) * 1e5 + 1e-9, "41032cbd0fba43c9", "3e10b551d9f64f0f", "3ff0000000000000"],
  [(Math.PI / 2) * 3 + 1e-12, "4012d97c7f332638", "bff0000000000000", "3d71972c36359b0c"],
  [(Math.PI / 2) * 7 - 1e-12, "4025fdbbe9bba542", "bff0000000000000", "bd7199ee2c2d963a"],
  [47 * (Math.PI / 180), "3fea3fefbe6956ec", "3fe7673fe0c86982", "3fe5d2ee398c9c2b"],
  [141 * (Math.PI / 180), "4003aff3cecf0131", "3fe4236484487abd", "bfe8de613515a328"],
  [329 * (Math.PI / 180), "4016f7f1c69c2c0e", "bfe07b3120fddf16", "3feb6dea1e76eadc"],
  [(Math.PI * 2 * 3) / 16, "3ff2d97c7f3321d2", "3fed906bcf328d46", "3fd87de2a6aea964"],
  [(5 / 8) * Math.PI * 2, "400f6a7a2955385e", "bfe6a09e667f3bcc", "bfe6a09e667f3bce"],
  [-7 * 0.008, "bfacac083126e979", "bfaca8323ae9c021", "3feff3288661854b"],
  [(60 * Math.PI) / 180, "3ff0c152382d7365", "3febb67ae8584caa", "3fe0000000000001"],
  [(-90 * Math.PI) / 180, "bff921fb54442d18", "bff0000000000000", "3c91a62633145c07"],
];

describe("det-math", () => {
  it("gives the recorded bits for a spread of angles, near multiples of pi/2 and far out", () => {
    for (const [x, input, sin, cos] of CASES) {
      expect(bits(x)).toBe(input);
      expect([bits(detSin(x)), bits(detCos(x))]).toEqual([sin, cos]);
    }
  });

  it("gives the recorded bits for the angles the game uses", () => {
    // Trained units spawn at (nextId * 47 mod 360) degrees; rings of 16 and 8 points; rich-map rotations; creep camps;
    // V7 staging turns.
    expect(digest(Array.from({ length: 360 }, (_, degrees) => degrees * (Math.PI / 180)))).toBe("a2e044fbe5b00554");
    expect(digest(Array.from({ length: 16 }, (_, index) => (Math.PI * 2 * index) / 16))).toBe("8a2952e5549c336d");
    expect(digest(Array.from({ length: 8 }, (_, index) => (index / 8) * Math.PI * 2))).toBe("ebc0237198c696e6");
    expect(digest(Array.from({ length: 15 }, (_, index) => (index - 7) * 0.008))).toBe("6e683927cdc98fa3");
    expect(digest([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => Array.from({ length: n }, (_, index) => (Math.PI * 2 * index) / Math.max(1, n))))).toBe("d226bf9881828776");
    expect(digest([0, 30, -30, 60, -60, 90, -90].map((degrees) => (degrees * Math.PI) / 180))).toBe("10b1328d4805aa89");
  });

  it("gives the recorded bits over 200,000 angles in [-1000, 1000) and stays within an ulp of Math", () => {
    let state = 0x2468ace0;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0), state / 4294967296);
    const xs = Array.from({ length: 200_000 }, () => (random() - 0.5) * 2000);
    expect(digest(xs)).toBe("f8b9713f72d6ccf8");
    // Math's own results differ by an ulp between platforms, so this allows two ulps of a value below 1 (2^-52).
    const worst = xs.reduce((most, x) => Math.max(most, Math.abs(detSin(x) - Math.sin(x)), Math.abs(detCos(x) - Math.cos(x))), 0);
    expect(worst).toBeLessThanOrEqual(2 ** -52);
  });

  it("keeps the edges of Math.sin and Math.cos, and refuses angles beyond its range", () => {
    expect(Object.is(detSin(-0), -0)).toBe(true);
    expect(detSin(Number.NaN)).toBeNaN();
    expect(detCos(Number.POSITIVE_INFINITY)).toBeNaN();
    expect(() => detSin(1e7)).toThrow(/outside the supported range/);
  });
});

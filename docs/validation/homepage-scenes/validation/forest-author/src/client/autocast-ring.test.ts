import fs from "node:fs";
import { describe, expect, it } from "vitest";

// The autocast border is pure CSS (battle-hud.css); these read the rules that decide when it shows and when it moves.
const CSS = fs.readFileSync("src/client/battle-hud.css", "utf8");

function rule(selector: string, source = CSS) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return undefined;
  return source.slice(start, source.indexOf("}", start) + 1);
}

function reducedMotionBlock() {
  const start = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start, "battle-hud.css has a reduced-motion block").toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = CSS.indexOf("{", start); index < CSS.length; index += 1) {
    if (CSS[index] === "{") depth += 1;
    if (CSS[index] === "}") depth -= 1;
    if (depth === 0) return CSS.slice(start, index + 1);
  }
  return CSS.slice(start);
}

// The same ring marks the stance the selected fighters are in (see stance-buttons): pressed "all" as autocast "on",
// "some" as "mixed".
describe("autocast ring", () => {
  it("is hidden until a spell's autocast is on (or on for some of the selection), or a stance is held", () => {
    expect(rule(".autocast-ring")).toMatch(/display: none;/);
    expect(CSS).toContain(
      '.command-button[data-autocast="on"] .autocast-ring,\n.command-button[data-autocast="mixed"] .autocast-ring,\n.command-button[data-pressed="all"] .autocast-ring,\n.command-button[data-pressed="some"] .autocast-ring {\n  display: block;',
    );
    expect(CSS).not.toMatch(/data-autocast="off"/);
  });

  it("runs its sparks round the border, and stands still when only some of the selection has it on", () => {
    expect(rule(".autocast-ring::before")).toMatch(/animation: autocast-turn [\d.]+s linear infinite;/);
    expect(CSS).toMatch(/@keyframes autocast-turn \{\s*to \{\s*--autocast-turn: 360deg;/);
    expect(CSS).toContain('.command-button[data-autocast="mixed"] .autocast-ring::before,\n.command-button[data-pressed="some"] .autocast-ring::before {');
    expect(rule('.command-button[data-pressed="some"] .autocast-ring::before')).toMatch(/animation: none;/);
  });

  it("stops moving for players who ask for reduced motion, and still shows the ring", () => {
    const block = reducedMotionBlock();
    expect(block).toContain('  .command-button[data-autocast="on"] .autocast-ring::before,\n  .command-button[data-pressed="all"] .autocast-ring::before {');
    const still = rule('  .command-button[data-pressed="all"] .autocast-ring::before', block);
    expect(still).toMatch(/animation: none;/);
    expect(still).toMatch(/background: /);
  });
});

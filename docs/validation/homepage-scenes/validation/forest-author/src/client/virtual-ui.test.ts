import { describe, expect, it } from "vitest";
import { virtualClickableTargetFromElement, virtualContextTargetFromElement, virtualTooltipTargetFromElement } from "./virtual-ui";

describe("virtual pointer UI hit testing", () => {
  it("finds tooltip and button targets through the element under the virtual pointer", () => {
    const button = target("button", true);
    const icon = target("span", false, button);

    expect(virtualTooltipTargetFromElement(icon)).toBe(button);
    expect(virtualClickableTargetFromElement(icon)).toBe(button);
  });

  it("does not treat plain canvas hits as UI clicks or tooltips", () => {
    const canvas = target("canvas", false);

    expect(virtualTooltipTargetFromElement(canvas)).toBeUndefined();
    expect(virtualClickableTargetFromElement(canvas)).toBeUndefined();
    expect(virtualContextTargetFromElement(canvas)).toBeUndefined();
  });

  it("gives a right-click to the button under the cursor even while it is disabled, so it never falls through to the field", () => {
    const cooling = target("button", true, undefined, true);
    const icon = target("span", false, cooling);

    expect(virtualClickableTargetFromElement(icon)).toBeUndefined();
    expect(virtualContextTargetFromElement(icon)).toBe(cooling);
  });
});

function target(name: string, tooltip: boolean, parent?: FakeTarget, disabled = false): FakeTarget {
  return {
    name,
    dataset: tooltip ? { tooltipTitle: name } : {},
    closest(selector: string) {
      if (selector === "[data-tooltip-title]") return this.dataset.tooltipTitle ? this : parent?.closest(selector);
      if (selector === "button:not(:disabled), [role='button'], a[href], input, select, textarea") return this.name === "button" && !disabled ? this : parent?.closest(selector);
      if (selector === "button, [role='button']") return this.name === "button" ? this : parent?.closest(selector);
      return undefined;
    },
  };
}

type FakeTarget = {
  name: string;
  dataset: { tooltipTitle?: string };
  closest: (selector: string) => FakeTarget | undefined;
};

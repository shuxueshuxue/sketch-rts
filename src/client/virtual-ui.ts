const CLICKABLE_SELECTOR = "button:not(:disabled), [role='button'], a[href], input, select, textarea";
// A right-click belongs to any button under the cursor, a disabled one too (a spell cooling down still switches autocast).
const CONTEXT_SELECTOR = "button, [role='button']";

type TooltipElement = {
  dataset: { tooltipTitle?: string };
};

type ClosestTarget<T> = {
  closest: (selector: string) => T | null | undefined;
};

export function virtualTooltipTargetFromElement<T extends TooltipElement>(element: ClosestTarget<T> | null | undefined) {
  const target = element?.closest("[data-tooltip-title]");
  return target?.dataset.tooltipTitle ? target : undefined;
}

export function virtualClickableTargetFromElement<T>(element: ClosestTarget<T> | null | undefined) {
  return element?.closest(CLICKABLE_SELECTOR) ?? undefined;
}

export function virtualContextTargetFromElement<T>(element: ClosestTarget<T> | null | undefined) {
  return element?.closest(CONTEXT_SELECTOR) ?? undefined;
}

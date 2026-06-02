const CLICKABLE_SELECTOR = "button:not(:disabled), [role='button'], a[href], input, select, textarea";

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

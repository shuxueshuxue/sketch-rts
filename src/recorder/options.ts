import { UNIT_DEFS } from "../shared/catalog";
import type { UnitKind } from "../shared/types";
import type { CameraSpec, UnitSelector } from "./scene";

export function parseSize(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Size must look like 1280x720, got "${value}"`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 16 || height < 16) throw new Error(`Size ${value} is too small`);
  return { width, height };
}

/** `x,y` or `x,y,zoom`: the world point at the centre of the frame. */
export function parseFixedCamera(value: string): CameraSpec {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Camera must look like x,y or x,y,zoom, got "${value}"`);
  }
  const [x, y, zoom] = parts as [number, number, number | undefined];
  return { type: "fixed", x, y, ...(zoom !== undefined ? { zoom: positive(zoom, "zoom") } : {}) };
}

/**
 * `all`, or comma-separated filters that all apply: `owner=north`, `kind=raider|knight`, `id=<unit id>|<unit id>`.
 */
export function parseUnitSelector(value: string): UnitSelector {
  if (value.trim() === "all") return {};
  const selector: UnitSelector = {};
  for (const part of value.split(",")) {
    const [key, list] = part.split("=").map((piece) => piece.trim());
    const items = (list ?? "").split("|").map((item) => item.trim()).filter(Boolean);
    if (!key || items.length === 0) throw new Error(`Follow filter must look like key=value, got "${part}"`);
    if (key === "owner") selector.owners = items;
    else if (key === "id") selector.ids = items;
    else if (key === "kind") selector.kinds = items.map(unitKind);
    else throw new Error(`Unknown follow filter "${key}" (use owner, kind or id)`);
  }
  return selector;
}

export function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got ${value}`);
  return value;
}

function unitKind(value: string): UnitKind {
  if (!(value in UNIT_DEFS)) throw new Error(`Unknown unit kind "${value}"`);
  return value as UnitKind;
}

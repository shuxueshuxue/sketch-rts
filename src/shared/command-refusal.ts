import type { AbilityKind, BuildingKind, ItemKind, Owner } from "./types";
import type { UnitBodyForm } from "./unit-body-form";

/** Stable, language-independent causes. Presentation supplies the words. */
export type GarrisonRefusal =
  | { reason: "garrison-mechanical"; detail: { buildingId: string } }
  | { reason: "garrison-not-infantry"; detail: { buildingId: string; bodyForm: Exclude<UnitBodyForm, "foot" | "machine"> } }
  | { reason: "tower-full"; detail: { buildingId: string; used: number; capacity: number; required: number } }
  | { reason: "garrison-body-size"; detail: { buildingId: string; radius: number; towerRadius: number } }
  | { reason: "garrison-ownership"; detail: { buildingId: string; owner: Owner } }
  | { reason: "garrison-ineligible"; detail: { buildingId: string } };
export type CommandRefusalCategory = "gold" | "supply" | "tier" | "stock" | "cooldown" | "position"
  | "gone" | "target" | "range" | "unreachable" | "occupied" | "state" | "rules";

export type CommandRefusal = GarrisonRefusal
  | { reason: "gold"; detail: { required: number; available: number } }
  | { reason: "supply"; detail: { required: number; used: number; capacity: number } }
  | { reason: "supply-tier"; detail: { requiredCap: number; currentCap: number } }
  | { reason: "cooldown"; detail: { remainingTicks: number; ability?: AbilityKind; itemId?: string } }
  | { reason: "stock-empty"; detail: { sellerId: string; kind?: string; remainingTicks?: number } }
  | { reason: "inventory-full"; detail: { unitId: string } }
  | { reason: "inventory-incompatible"; detail: { unitId: string; itemKind: ItemKind } }
  | { reason: "target-type"; detail: { targetId?: string; required: "mechanical" | "non-mechanical" | "friendly-unit" | "enemy-unit" | "enemy-building" | "unit-or-point" } }
  | { reason: "ownership"; detail: { entityId: string; requiredRelation: "own" | "friendly" | "enemy" } }
  | { reason: "inside-min-range"; detail: { targetId?: string; minimum: number; distance: number } }
  | { reason: "unreachable"; detail: { targetId?: string } }
  | { reason: "site-occupied"; detail: { buildingKind: BuildingKind; blockerId?: string } }
  | { reason: "site-terrain"; detail: { buildingKind: BuildingKind } }
  | { reason: "building-incomplete"; detail: { buildingId: string } }
  | { reason: "target-gone"; detail: { targetId: string } }
  | { reason: "issuer-gone"; detail: { entityId: string } }
  | { reason: "unit-ineligible"; detail: { required: "worker" | "armed" | "ranged" | "hold-capable" | "transport" | "melee" } }
  | { reason: "item-not-carried"; detail: { itemId: string; unitId: string } }
  | { reason: "item-passive"; detail: { itemKind: ItemKind } }
  // Phase two refines ship, fitting and equipment conditions. Never invent a more specific cause from prose.
  | { reason: "condition-unmet"; detail: { category: CommandRefusalCategory } };

/** Validate the private server receipt at the wire boundary, before presentation reads numeric facts. */
export function isCommandRefusal(value: unknown): value is CommandRefusal {
  if (!value || typeof value !== "object") return false;
  const { reason, detail } = value as { reason?: unknown; detail?: unknown };
  if (!detail || typeof detail !== "object") return false;
  const d = detail as Record<string, unknown>;
  const strings = (...keys: string[]) => keys.every(key => typeof d[key] === "string");
  const numbers = (...keys: string[]) => keys.every(key => typeof d[key] === "number" && Number.isFinite(d[key]));
  const optionalString = (key: string) => d[key] === undefined || typeof d[key] === "string";
  switch (reason) {
    case "garrison-mechanical": case "garrison-ineligible": case "building-incomplete": return strings("buildingId");
    case "garrison-not-infantry": return strings("buildingId") && ["mounted", "beast", "spirit"].includes(String(d.bodyForm));
    case "tower-full": return strings("buildingId") && numbers("used", "capacity", "required");
    case "garrison-body-size": return strings("buildingId") && numbers("radius", "towerRadius");
    case "garrison-ownership": return strings("buildingId", "owner");
    case "gold": return numbers("required", "available");
    case "supply": return numbers("required", "used", "capacity");
    case "supply-tier": return numbers("requiredCap", "currentCap");
    case "cooldown": return numbers("remainingTicks") && optionalString("ability") && optionalString("itemId");
    case "stock-empty": return strings("sellerId") && optionalString("kind") && (d.remainingTicks === undefined || numbers("remainingTicks"));
    case "inventory-full": return strings("unitId");
    case "inventory-incompatible": return strings("unitId", "itemKind");
    case "target-type": return optionalString("targetId") && ["mechanical", "non-mechanical", "friendly-unit", "enemy-unit", "enemy-building", "unit-or-point"].includes(String(d.required));
    case "ownership": return strings("entityId") && ["own", "friendly", "enemy"].includes(String(d.requiredRelation));
    case "inside-min-range": return optionalString("targetId") && numbers("minimum", "distance");
    case "unreachable": return optionalString("targetId");
    case "site-occupied": return strings("buildingKind") && optionalString("blockerId");
    case "site-terrain": return strings("buildingKind");
    case "target-gone": return strings("targetId");
    case "issuer-gone": return strings("entityId");
    case "unit-ineligible": return ["worker", "armed", "ranged", "hold-capable", "transport", "melee"].includes(String(d.required));
    case "item-not-carried": return strings("itemId", "unitId");
    case "item-passive": return strings("itemKind");
    case "condition-unmet": return ["gold", "supply", "tier", "stock", "cooldown", "position", "gone", "target", "range", "unreachable", "occupied", "state", "rules"].includes(String(d.category));
    default: return false;
  }
}

export function refusalFromError(error: unknown): CommandRefusal | undefined {
  if (!error || typeof error !== "object") return;
  const candidate = error as { commandRefusal?: unknown; refusal?: unknown };
  if (isCommandRefusal(candidate.commandRefusal)) return candidate.commandRefusal;
  const result = candidate.refusal;
  if (isCommandRefusal(result)) return result;
  if (result && typeof result === "object" && "refusal" in result && isCommandRefusal(result.refusal)) return result.refusal;
}

import type { Owner } from "./types";
import type { UnitBodyForm } from "./unit-body-form";

/** Stable, language-independent causes. Presentation supplies the words. */
export type GarrisonRefusal =
  | { reason: "garrison-mechanical"; detail: { buildingId: string } }
  | { reason: "garrison-not-infantry"; detail: { buildingId: string; bodyForm: Exclude<UnitBodyForm, "foot" | "machine"> } }
  | { reason: "tower-full"; detail: { buildingId: string; used: number; capacity: number; required: number } }
  | { reason: "garrison-body-size"; detail: { buildingId: string; radius: number; towerRadius: number } }
  | { reason: "garrison-ownership"; detail: { buildingId: string; owner: Owner } }
  | { reason: "garrison-ineligible"; detail: { buildingId: string } };
export type CommandRefusal = GarrisonRefusal;

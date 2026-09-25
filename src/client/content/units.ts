import type { TrainableUnitKind, UnitKind } from "../../shared/types";
import type { TrainedUnitCard, UnitCard } from "./cards";
import { COMMON_UNITS } from "./units-common";
import { EMBER_UNITS } from "./units-ember";
import { GROVE_UNITS } from "./units-grove";
import { NEUTRAL_UNITS } from "./units-neutral";

// Every trainable unit needs a full card (tooltip words and a command button); the rest need a name and a painter.
export const TRAINED_UNIT_CARDS: Record<TrainableUnitKind, TrainedUnitCard> = { ...COMMON_UNITS, ...GROVE_UNITS, ...EMBER_UNITS };

export const UNIT_CARDS: Record<UnitKind, UnitCard> = { ...TRAINED_UNIT_CARDS, ...NEUTRAL_UNITS };

export function mapUnitCards<T>(pick: (card: UnitCard) => T): Record<UnitKind, T> {
  return Object.fromEntries(Object.entries(UNIT_CARDS).map(([kind, card]) => [kind, pick(card)])) as Record<UnitKind, T>;
}

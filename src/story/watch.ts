import type { Game, SimObserver } from "../shared/sim";
import type { Building, Unit } from "../shared/types";
import type { StoryEvent } from "./events";
import { instant } from "./time";

type Hit = { attacker: Unit | Building; target: Unit | Building; damage: number; hpBefore: number };

// Watches a game for the Director (see story-events): every hit as the sim reports it, and, once a tick, what arrived,
// left, was founded, finished or picked up since the last look. Hits the script itself strikes between ticks are
// reported with the next tick's.
export class WorldWatch implements SimObserver {
  private hits: Hit[] = [];
  private readonly units = new Map<string, Unit>();
  private readonly fallen = new Set<string>();
  private readonly buildings = new Map<string, boolean>();
  private readonly carriers = new Map<string, string | undefined>();

  constructor(game: Game) {
    this.remember(game);
  }

  // No blow waits to be reported.
  get quiet() {
    return this.hits.length === 0;
  }

  hit(attacker: Unit | Building, target: Unit | Building, damage: number, hpBefore: number) {
    this.hits.push({ attacker, target, damage, hpBefore });
  }

  // What happened since the last call, in order: the blows as they landed (a killing blow followed by its death), then
  // the units that came and went, then the buildings and the items.
  collect(game: Game): StoryEvent[] {
    const at = instant(game.tick);
    const events: StoryEvent[] = [];
    for (const { attacker, target, damage, hpBefore } of this.hits.splice(0)) {
      events.push({ type: "hit", at, attacker, target, damage });
      if (hpBefore <= 0 || target.hp > 0) continue;
      if ("order" in target) {
        this.fallen.add(target.id);
        events.push({ type: "died", at, unit: target, killer: attacker });
      } else {
        events.push({ type: "destroyed", at, building: target, by: attacker });
      }
    }
    const present = new Set<string>();
    for (const unit of game.units) {
      present.add(unit.id);
      if (!this.units.has(unit.id)) events.push({ type: "arrived", at, unit });
      this.units.set(unit.id, unit);
    }
    for (const [id, unit] of this.units) {
      if (present.has(id)) continue;
      this.units.delete(id);
      if (!this.fallen.delete(id)) events.push({ type: "departed", at, unit });
    }
    const standing = new Set<string>();
    for (const building of game.buildings) {
      standing.add(building.id);
      const wasComplete = this.buildings.get(building.id);
      if (wasComplete === undefined) events.push({ type: "founded", at, building });
      if (building.complete && wasComplete === false) events.push({ type: "completed", at, building });
      this.buildings.set(building.id, building.complete);
    }
    for (const id of [...this.buildings.keys()]) if (!standing.has(id)) this.buildings.delete(id);
    for (const item of game.items) {
      const before = this.carriers.get(item.id);
      if (item.carrierId && item.carrierId !== before) {
        const unit = game.units.find((candidate) => candidate.id === item.carrierId);
        if (unit) events.push({ type: "pickedUp", at, item, unit });
      }
      this.carriers.set(item.id, item.carrierId);
    }
    return events;
  }

  private remember(game: Game) {
    for (const unit of game.units) this.units.set(unit.id, unit);
    for (const building of game.buildings) this.buildings.set(building.id, building.complete);
    for (const item of game.items) this.carriers.set(item.id, item.carrierId);
  }
}

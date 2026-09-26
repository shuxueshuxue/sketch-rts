import type { WorldView } from "../client/world-renderer";
import type { GameSnapshot, Unit } from "../shared/types";
import type { CameraSpec, UnitSelector } from "./scene";

type Point = { x: number; y: number };

export const DEFAULT_FOLLOW_LAG_SECONDS = 0.6;

export function selectUnits(units: readonly Unit[], selector: UnitSelector = {}) {
  return units.filter(
    (unit) =>
      unit.owner !== "neutral" &&
      (!selector.owners || selector.owners.includes(unit.owner)) &&
      (!selector.kinds || selector.kinds.includes(unit.kind)) &&
      (!selector.ids || selector.ids.includes(unit.id)),
  );
}

export function unitsCentre(units: readonly Unit[]): Point | undefined {
  if (units.length === 0) return undefined;
  return {
    x: units.reduce((sum, unit) => sum + unit.x, 0) / units.length,
    y: units.reduce((sum, unit) => sum + unit.y, 0) / units.length,
  };
}

/** Where the recording looks, frame by frame. Like the client's camera, it never shows past the map's edge. */
export class RecorderCamera {
  private centre: Point | undefined;

  constructor(
    private readonly spec: CameraSpec,
    private readonly size: { width: number; height: number },
  ) {}

  view(snapshot: GameSnapshot, elapsedSeconds: number): WorldView {
    const target = this.target(snapshot);
    if (!this.centre || this.spec.type === "fixed") {
      this.centre = target;
    } else {
      const lag = this.spec.lagSeconds ?? DEFAULT_FOLLOW_LAG_SECONDS;
      const pull = lag <= 0 ? 1 : 1 - Math.exp(-elapsedSeconds / lag);
      this.centre = { x: this.centre.x + (target.x - this.centre.x) * pull, y: this.centre.y + (target.y - this.centre.y) * pull };
    }
    const zoom = this.spec.zoom ?? 1;
    const worldWidth = this.size.width / zoom;
    const worldHeight = this.size.height / zoom;
    // Whole screen pixels, as the client's camera steps: the paper texture and sprites don't shimmer between frames.
    return {
      x: toPixel(Math.max(0, Math.min(snapshot.map.width - worldWidth, this.centre.x - worldWidth / 2)), zoom),
      y: toPixel(Math.max(0, Math.min(snapshot.map.height - worldHeight, this.centre.y - worldHeight / 2)), zoom),
      width: this.size.width,
      height: this.size.height,
      zoom,
    };
  }

  private target(snapshot: GameSnapshot): Point {
    if (this.spec.type === "fixed") return { x: this.spec.x, y: this.spec.y };
    // With nobody left to follow, hold still where the camera already is.
    return unitsCentre(selectUnits(snapshot.units, this.spec.select)) ?? this.centre ?? { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
  }
}

function toPixel(world: number, zoom: number) {
  return Math.round(world * zoom) / zoom;
}

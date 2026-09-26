import type { WorldView } from "../client/world-renderer";
import type { StageView } from "../story/stage";
import type { GameSnapshot } from "../shared/types";

type Point = { x: number; y: number };

// Where a story's recording looks: where the stage says (a unit, a group, a point), else at whoever spoke last in a
// cutscene, else where the story's default focus is (the party). It eases toward its target like the follow camera,
// eases its zoom the same way, cuts instead of panning across the map when the story jumps somewhere far (under a
// fade), and shakes when the stage quakes. It is a function of the story's frames alone, so a recording cut into pieces
// and joined again pans exactly as one made in one go (see record: --from).
export class StoryCamera {
  private centre?: Point;
  private zoom?: number;

  constructor(
    private readonly size: { width: number; height: number },
    private readonly focus: (snapshot: GameSnapshot) => Point | undefined,
    private readonly options: { zoom: number; lagSeconds: number } = { zoom: 1, lagSeconds: 0.7 },
  ) {}

  view(snapshot: GameSnapshot, stage: StageView, elapsedSeconds: number): WorldView {
    const target = this.target(snapshot, stage);
    const wantedZoom = stage.camera.zoom ?? this.options.zoom;
    const pull = elapsedSeconds <= 0 ? 1 : 1 - Math.exp(-elapsedSeconds / this.options.lagSeconds);
    if (!this.centre || distance(this.centre, target) > 1600) this.centre = target;
    else this.centre = { x: this.centre.x + (target.x - this.centre.x) * pull, y: this.centre.y + (target.y - this.centre.y) * pull };
    this.zoom = this.zoom === undefined ? wantedZoom : this.zoom + (wantedZoom - this.zoom) * pull;
    const zoom = this.zoom;
    const shake = shakeOffset(stage);
    const worldWidth = this.size.width / zoom;
    const worldHeight = this.size.height / zoom;
    return {
      x: toPixel(Math.max(0, Math.min(snapshot.map.width - worldWidth, this.centre.x - worldWidth / 2)) + shake.x, zoom),
      y: toPixel(Math.max(0, Math.min(snapshot.map.height - worldHeight, this.centre.y - worldHeight / 2)) + shake.y, zoom),
      width: this.size.width,
      height: this.size.height,
      zoom,
    };
  }

  private target(snapshot: GameSnapshot, stage: StageView): Point {
    const camera = stage.camera;
    if (camera.mode === "point") return { x: camera.x, y: camera.y };
    if (camera.mode === "follow") {
      const followed = snapshot.units.filter((unit) => camera.unitIds.includes(unit.id));
      if (followed.length > 0) return centreOf(followed);
    }
    if (stage.focusId) {
      const speaker = snapshot.units.find((unit) => unit.id === stage.focusId);
      if (speaker) return { x: speaker.x, y: speaker.y - 40 };
    }
    return this.focus(snapshot) ?? this.centre ?? { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
  }
}

function shakeOffset(stage: StageView): Point {
  const shake = stage.shake;
  if (!shake || stage.tick >= shake.end) return { x: 0, y: 0 };
  const fade = (shake.end - stage.tick) / Math.max(1, shake.end - shake.start);
  const t = stage.tick - shake.start;
  return { x: Math.sin(t * 2.3) * shake.amount * fade, y: Math.cos(t * 3.1) * shake.amount * 0.6 * fade };
}

function centreOf(points: readonly Point[]): Point {
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toPixel(world: number, zoom: number) {
  return Math.round(world * zoom) / zoom;
}

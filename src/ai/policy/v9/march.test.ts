import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import { distance } from "../spatial";
import { marchPoint } from "./march";

function board(camps: { x: number; y: number }[]) {
  let scene = sketchScene("v9-march")
    .map("openClaims")
    .replaceDefaults()
    .player("v9", { team: "north", race: "grove" })
    .player("v8", { team: "south", race: "ember" })
    .townHall("v9", 500, 500, { id: "v9-hall" })
    .townHall("v8", 3_400, 3_300, { id: "v8-hall" });
  camps.forEach((camp, index) => {
    scene = scene.unit("neutral", "stonebackBrute", camp.x, camp.y, { id: `brute-${index}-a` }).unit("neutral", "stonebackBrute", camp.x + 60, camp.y + 30, { id: `brute-${index}-b` });
  });
  return snapshotGame(scene.build().createGame());
}

const FROM = { x: 800, y: 800 };
const TO = { x: 3_200, y: 3_100 };

describe("v9 march", () => {
  it("heads straight for the target when no camp stands in the way", () => {
    expect(marchPoint(board([{ x: 2_600, y: 800 }]), FROM, TO)).toEqual(TO);
  });

  it("steps out beside a camp on the line, far enough that the walk on clears it", () => {
    const snapshot = board([{ x: 2_000, y: 1_950 }]);
    const point = marchPoint(snapshot, FROM, TO);
    expect(point).not.toEqual(TO);
    expect(distance(point, { x: 2_030, y: 1_965 })).toBeGreaterThan(450);
    // From the point beside the camp the march goes straight on.
    expect(marchPoint(snapshot, point, TO)).toEqual(TO);
  });

  it("keeps walking round a camp it has come up to", () => {
    const snapshot = board([{ x: 2_000, y: 1_950 }]);
    const near = { x: 1_700, y: 1_700 };
    const point = marchPoint(snapshot, near, TO);
    expect(point).not.toEqual(TO);
    expect(distance(point, { x: 2_030, y: 1_965 })).toBeGreaterThan(450);
  });

  it("fights a camp by the target where it stands", () => {
    expect(marchPoint(board([{ x: 3_000, y: 2_950 }]), FROM, TO)).toEqual(TO);
  });
});

import { createSquadMemory, planSquad, type SquadIntent } from "../../ai/squad/squad";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { Building, BuildingKind, GameCommand, TrainableUnitKind, Unit } from "../../shared/types";
import type { PlayerControls } from "../../story/director";
import { spawn, type Operation } from "../../story/kernel";
import { wait } from "../../story/ops";
import { centerOf, distance, type Point } from "../../story/region";
import type { MarkerView, StageView } from "../../story/stage";
import { seconds } from "../../story/time";
import { densest, HERO_IDS, PLAYER } from "./common";
import { OUTPOST_SPOTS } from "./chapters/outpost";

// @@@ashen-pilot - The player of the recording: a script that plays the campaign through the same doors a human has. It
// reads the screen (the stage: objectives, markers, the open choice, whether a cutscene is running) and the field, and
// answers with commands and choices, nothing else; it cannot touch the story. It plays like a steady player: it follows
// the quest marks, holds where the story asks it to hold, steps out of fire it sees coming, keeps its army together
// under the squad brain (ai/squad), runs the outpost's economy, and makes the choices of one particular playthrough.

// The choices this playthrough makes, by choice id.
const PICKS: Record<string, string> = { tracks: "follow", ig: "spare", bao: "truth", pass: "stand", vashka: "spare" };
// How long the pilot reads a choice before it answers (the viewer reads it too).
const READING = seconds(4.5);
const THINK = seconds(0.5);
const STRAGGLER = 800;

export function* pilot(controls: PlayerControls): Operation<void> {
  yield* spawn(() => chooser(controls), "pilot:choices");
  yield* spawn(() => economy(controls), "pilot:economy");
  const memory = createSquadMemory();
  let lastGoal = "";
  for (;;) {
    yield* wait(THINK);
    const view = controls.stage.view();
    if (view.letterbox.on || view.choice) continue;
    const own = controls.game.units.filter((unit) => unit.owner === PLAYER && unit.hp > 0 && unit.kind !== "worker");
    if (own.length === 0) continue;
    const dodging = dodge(controls, own, view);
    // The army gathers on its own heart (a hero there if one is), not on a hero who has wandered off.
    const heart = densest(own, 600)!;
    const leader = HERO_IDS_LIST.map((id) => own.find((unit) => unit.id === id)).find((unit): unit is Unit => unit !== undefined && distance(unit, heart) <= 600) ?? heart;
    const main = own.filter((unit) => !dodging.has(unit.id) && distance(unit, leader) <= STRAGGLER);
    const stragglers = own.filter((unit) => !dodging.has(unit.id) && distance(unit, leader) > STRAGGLER);
    if (stragglers.length > 0) controls.command({ type: "attackMove", unitIds: stragglers.map((unit) => unit.id), x: leader.x, y: leader.y });
    const { intent, key } = goal(controls, view, main);
    if (key !== lastGoal) {
      lastGoal = key;
      memory.state = "advance";
      delete memory.focusId;
    }
    const plan = planSquad(controls.game, PLAYER, main.map((unit) => unit.id), intent, memory, { nerve: 0.5, retreatTo: centerOf(main) });
    for (const command of plan.commands) controls.command(command);
  }
}

const HERO_IDS_LIST = [HERO_IDS.lynn, HERO_IDS.du, HERO_IDS.tess, HERO_IDS.ig];

// What the army is for right now, read off the screen: hold where a rally mark stands; go to the nearest quest mark;
// go for the nearest target; otherwise fight what is near, or wait where it is.
function goal(controls: PlayerControls, view: StageView, army: readonly Unit[]): { intent: SquadIntent; key: string } {
  const center = centerOf(army);
  const rally = nearestMarker(view, center, "rally");
  if (rally) return { intent: { kind: "hold", at: rally, leash: 420 }, key: `rally:${rally.id}` };
  const quest = nearestMarker(view, center, "quest");
  if (quest) return { intent: { kind: "attack", at: quest }, key: `quest:${quest.id}` };
  const target = nearestMarker(view, center, "target");
  if (target) return { intent: { kind: "attack", at: target }, key: `target:${target.id}` };
  const foe = controls.game.units.filter((unit) => unit.hp > 0 && isFoe(controls, unit) && distance(unit, center) < 700).sort((a, b) => distance(a, center) - distance(b, center))[0];
  if (foe) return { intent: { kind: "attack", at: { x: foe.x, y: foe.y } }, key: "skirmish" };
  return { intent: { kind: "hold", at: center, leash: 300 }, key: "wait" };
}

function nearestMarker(view: StageView, from: Point, kind: MarkerView["kind"]) {
  return view.markers.filter((marker) => marker.kind === kind).sort((a, b) => distance(a, from) - distance(b, from))[0];
}

function isFoe(controls: PlayerControls, unit: Unit) {
  const teams = controls.game.teams;
  return unit.owner !== PLAYER && (unit.owner === "neutral" || teams[unit.owner] !== teams[PLAYER]);
}

// Steps out of the red circles (fire about to fall) the way a player would: straight away from the middle.
function dodge(controls: PlayerControls, own: readonly Unit[], view: StageView): Set<string> {
  const dodging = new Set<string>();
  for (const marker of view.markers) {
    if (marker.kind !== "danger") continue;
    for (const unit of own) {
      const gap = distance(unit, marker);
      if (gap > marker.radius + unit.radius + 8) continue;
      const away = gap < 1 ? { x: 1, y: 0 } : { x: (unit.x - marker.x) / gap, y: (unit.y - marker.y) / gap };
      const out = marker.radius + unit.radius + 50;
      controls.command({ type: "move", unitIds: [unit.id], x: marker.x + away.x * out, y: marker.y + away.y * out });
      dodging.add(unit.id);
    }
  }
  return dodging;
}

function* chooser(controls: PlayerControls): Operation<void> {
  for (;;) {
    yield* wait(seconds(0.25));
    const choice = controls.stage.openChoice;
    if (!choice || choice.picked !== undefined) continue;
    if (controls.game.tick < choice.opened + READING) continue;
    const pick = PICKS[choice.id] ?? choice.options[0]!.id;
    controls.answer(choice.id, choice.options.some((option) => option.id === pick) ? pick : choice.options[0]!.id);
    yield* wait(seconds(2));
  }
}

// ---- The outpost's economy: mine, build, train, as a player keeps a small base running.

function* economy(controls: PlayerControls): Operation<void> {
  for (;;) {
    yield* wait(seconds(1));
    const game = controls.game;
    const halls = game.buildings.filter((building) => building.owner === PLAYER && building.kind === "townHall" && building.complete);
    if (halls.length === 0) continue;
    const view = controls.stage.view();
    if (view.letterbox.on) continue;
    const player = game.players[PLAYER]!;
    const workers = game.units.filter((unit) => unit.owner === PLAYER && unit.kind === "worker" && unit.hp > 0);
    const mines = game.resources.filter((resource) => resource.amount > 0);
    const idle = workers.filter((worker) => worker.order.type === "idle");
    const mine = mines.sort((a, b) => distance(a, halls[0]!) - distance(b, halls[0]!))[0];
    if (idle.length > 0 && mine) controls.command({ type: "mine", unitIds: idle.map((worker) => worker.id), resourceId: mine.id });

    const mineOf = (kind: BuildingKind) => game.buildings.filter((building) => building.owner === PLAYER && building.kind === kind);
    let gold = player.gold;
    const builder = workers.find((worker) => worker.order.type === "mine") ?? workers[0];
    const build = (kind: BuildingKind, at: Point) => {
      if (!builder || gold < BUILDING_DEFS[kind].cost) return false;
      controls.command({ type: "build", unitId: builder.id, buildingKind: kind, x: at.x, y: at.y });
      gold -= BUILDING_DEFS[kind].cost;
      return true;
    };
    const unfinished = game.buildings.filter((building) => building.owner === PLAYER && !building.complete);
    // A site nobody is working on gets its builder back: a site goes up with the work of the workers whose order is to
    // repair it.
    for (const site of unfinished) {
      if (workers.some((worker) => worker.order.type === "repair" && worker.order.buildingId === site.id)) continue;
      const nearest = [...workers].sort((a, b) => distance(a, site) - distance(b, site))[0];
      if (nearest) controls.command({ type: "repair", unitIds: [nearest.id], buildingId: site.id });
    }
    const underway = unfinished.length > 0;
    if (!underway) {
      if (mineOf("barracks").length === 0) build("barracks", OUTPOST_SPOTS.barracks);
      else if (mineOf("archeryRange").length === 0 && mineOf("barracks").some((building) => building.complete)) build("archeryRange", OUTPOST_SPOTS.range);
      else if (player.supplyCap - player.supplyUsed < 4 && player.supplyCap < 40) {
        const spot = OUTPOST_SPOTS.moreFarms[mineOf("farm").length - OUTPOST_SPOTS.farms.length];
        if (spot) build("farm", spot);
      }
      else if (holding(view) && mineOf("defenseTower").length < OUTPOST_SPOTS.towers.length) build("defenseTower", OUTPOST_SPOTS.towers[mineOf("defenseTower").length]!);
    }
    // Keep every production building busy, footmen and archers in about equal numbers.
    for (const [kind, unitKind] of [["barracks", "footman"], ["archeryRange", "archer"]] as [BuildingKind, TrainableUnitKind][]) {
      for (const building of mineOf(kind)) {
        if (!building.complete || building.queue.length > 0) continue;
        const cost = UNIT_DEFS[unitKind].cost;
        if (gold < cost + 20 || player.supplyUsed + UNIT_DEFS[unitKind].supplyUsed > player.supplyCap) continue;
        controls.command({ type: "train", buildingId: building.id, unitKind });
        gold -= cost;
        rally(controls, building);
      }
    }
    if (workers.length < 6 && halls[0]!.queue.length === 0 && gold >= UNIT_DEFS.worker.cost + 150 && player.supplyUsed + 1 <= player.supplyCap) {
      controls.command({ type: "train", buildingId: halls[0]!.id, unitKind: "worker" });
    }
  }
}

function holding(view: StageView) {
  return view.objectives.some((objective) => objective.state === "active" && typeof objective.text !== "string" && objective.text.zh.includes("守住前哨"));
}

function rally(controls: PlayerControls, building: Building) {
  const at = OUTPOST_SPOTS.front;
  if (Math.hypot(building.rallyX - at.x, building.rallyY - at.y) < 10) return;
  const command: GameCommand = { type: "setRally", buildingIds: [building.id], x: at.x, y: at.y };
  controls.command(command);
}

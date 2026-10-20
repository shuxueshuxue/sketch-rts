import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../shared/sim";
import { createBuilding } from "../shared/map";
import { contextMovers, deckMovePoint, hasAlly, pointerTarget, relationTo, targetCommand, unitAt, unitPointerPosition } from "./relations";
import { boardUnit, syncDecks } from '../shared/decks';
import { deckVisualHeight } from './art/canvas-ships';
import type { GameSnapshot, Unit } from "../shared/types";

// The player and "enemy" on one team, "enemy2" on the other.
function alliedGame() {
  const game = createGame("verdantCrossroads", { players: ["player", "enemy", "enemy2"], aiPlayers: [], teams: { player: "north", enemy: "north", enemy2: "south" } });
  const own = game.spawnUnit("player", "footman", 600, 600);
  const ally = game.spawnUnit("enemy", "footman", 800, 600);
  const foe = game.spawnUnit("enemy2", "footman", 1000, 600);
  return { game, own, ally, foe };
}

it('selects raised crew before the hull and moves them across their own damaged deck', () => {
  const game = createGame('bareDuel',{aiPlayers:[]}); game.units=[]; delete game.map.terrain;
  const ship = game.spawnUnit('player','transport',800,800), worker=game.spawnUnit('player','worker',800,800);
  expect(boardUnit(ship,worker,game.units)).toBe(true); syncDecks(game.units); ship.hp-=20;
  const point=unitPointerPosition(game.units,worker), snapshot=snapshotGame(game);
  expect(unitAt(game.units,point,()=>true)?.id).toBe(worker.id);
  expect(pointerTarget(snapshot,point)).toMatchObject({kind:'unit',unit:{id:worker.id}});
  expect(targetCommand(snapshot,'player',[worker],{kind:'unit',unit:ship})).toBeUndefined();
  const floor={x:ship.x-15,y:ship.y-deckVisualHeight(ship)};
  expect(deckMovePoint(game.units,[worker],floor)).toEqual({x:ship.x-15,y:ship.y});
});

// @@@deck-click: a box over a ship takes the ship with its crew. A right-click on its deck moves the crew there and
// leaves the ship be; given the same point, the hull sailed to put its middle on it and swung round.
it('moves the crew of a selected ship to the clicked spot on its deck and leaves the ship holding', () => {
  const game = createGame('bareDuel',{aiPlayers:[]}); game.units=[]; game.items=[]; game.buildings=[]; game.resources=[]; game.obstacles=[];
  game.map={...game.map,width:3000,height:3000,terrain:{cell:40,cols:75,rows:75,cells:'~'.repeat(75*75)}};
  const ship=game.spawnUnit('player','warship',1500,1500), crew=game.spawnUnit('player','footman',1500,1500);
  expect(boardUnit(ship,crew,game.units)).toBe(true); syncDecks(game.units); crew.order={type:'idle'};
  const floor={x:ship.x,y:ship.y+12-deckVisualHeight(ship)}, snapshot=snapshotGame(game);
  const target=pointerTarget(snapshot,floor);
  expect(target).toMatchObject({kind:'unit',unit:{id:ship.id}});
  expect(targetCommand(snapshot,'player',[ship,crew],target as never)).toBeUndefined();
  const {movers,deck}=contextMovers(game.units,[ship,crew],floor,ship);
  expect([movers.map(unit=>unit.id),deck?.id]).toEqual([[crew.id],ship.id]);
  const spot=deckMovePoint(game.units,movers,floor);
  expect(spot).toEqual({x:ship.x,y:ship.y+12});
  issuePlayerCommand(game,'player',{type:'move',unitIds:movers.map(unit=>unit.id),x:spot.x,y:spot.y,avoidCombat:true});
  for(let tick=0;tick<100;tick++)stepGame(game);
  expect([ship.x,ship.y,ship.sailing!.heading,ship.order.type]).toEqual([1500,1500,0,'idle']);
  expect(Math.hypot(crew.x-spot.x,crew.y-spot.y)).toBeLessThan(10); expect(crew.order.type).toBe("idle");
  // A selection of ships alone still sails where it is sent, deck or not.
  expect(contextMovers(game.units,[ship],floor,ship)).toEqual({movers:[ship]});
});

it('never exposes a sheltered or trapped person as a battlefield pointer target',()=>{
  const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];delete game.map.terrain;
  const ship=game.spawnUnit('player','warship',800,800),crew=game.spawnUnit('player','priest',800,800);
  expect(boardUnit(ship,crew,game.units)).toBe(true);
  const point=unitPointerPosition(game.units,crew);crew.cabin={shipId:ship.id,breached:true};
  expect(unitAt(game.units,point,()=>true)?.id).not.toBe(crew.id);
  expect(pointerTarget(snapshotGame(game),point)).not.toMatchObject({kind:'unit',unit:{id:crew.id}});
});

// What a right-click there orders the player's selection (see @@@pointer-target and @@@context-target); none is a move.
function rightClick(snapshot: GameSnapshot, selected: Unit[], at: { x: number; y: number }, queued = false) {
  const target = pointerTarget(snapshot, at);
  return target && target.kind !== "item" ? targetCommand(snapshot, "player", selected, target, queued) : undefined;
}

describe("right-click orders", () => {
  it.each(["golem", "rubbleGolem", "rockGolem", "graniteGolem", "siegeRam", "ballista", "catapult", "organGun"] as const)("orders only workers to repair an own damaged %s", kind => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.spawnUnit("player", "worker", 900, 900);
    const soldier = game.spawnUnit("player", "footman", 930, 900);
    const mechanical = game.spawnUnit("player", kind, 1000, 900);
    mechanical.hp -= 30;
    const snapshot = snapshotGame(game);
    expect(targetCommand(snapshot, "player", [worker, soldier], { kind: "unit", unit: mechanical }, true)).toEqual({
      type: "repairUnit", unitIds: [worker.id], targetId: mechanical.id, queued: true,
    });
    expect(targetCommand(snapshot, "player", [soldier], { kind: "unit", unit: mechanical })).toBeUndefined();
    mechanical.hp = mechanical.maxHp;
    expect(targetCommand(snapshotGame(game), "player", [worker], { kind: "unit", unit: mechanical })).toBeUndefined();
    soldier.hp -= 30;
    expect(targetCommand(snapshotGame(game), "player", [worker], { kind: "unit", unit: soldier })).toBeUndefined();
  });

  it("repairs a damaged own hull from shore, boards a healthy hull and preserves movement on its own deck", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; delete game.map.terrain;
    const ship = game.spawnUnit("player", "transport", 900, 900);
    const worker = game.spawnUnit("player", "worker", 1000, 900);
    ship.hp -= 30;
    expect(targetCommand(snapshotGame(game), "player", [worker], { kind: "unit", unit: ship })).toMatchObject({ type: "repairUnit", targetId: ship.id, unitIds: [worker.id] });
    ship.hp = ship.maxHp;
    expect(targetCommand(snapshotGame(game), "player", [worker], { kind: "unit", unit: ship })).toMatchObject({ type: "board", transportId: ship.id, unitIds: [worker.id] });
    expect(boardUnit(ship, worker, game.units)).toBe(true);
    ship.hp -= 30;
    expect(targetCommand(snapshotGame(game), "player", [worker], { kind: "unit", unit: ship })).toBeUndefined();
  });

  it("follows an ally's unit and attacks an enemy's, as in Warcraft III; an own unit is a move", () => {
    const { game, own, ally, foe } = alliedGame();
    const snapshot = snapshotGame(game);
    expect(rightClick(snapshot, [own], ally, true)).toEqual({ type: "follow", unitIds: [own.id], targetId: ally.id, queued: true });
    expect(rightClick(snapshot, [own], foe)).toEqual({ type: "attack", unitIds: [own.id], targetId: foe.id, queued: false });
    expect(rightClick(snapshot, [own], own)).toBeUndefined();
  });

  it("takes what the pointer is on, the nearest: an ally or an enemy at a mine's foot, the mine on the mine", () => {
    const { game } = alliedGame();
    const mine = game.resources[0]!;
    const worker = game.spawnUnit("player", "worker", mine.x + 150, mine.y);
    const soldier = game.spawnUnit("player", "footman", mine.x + 150, mine.y + 60);
    // Both within the mine's reach (84 from its middle), the ally on one side and the enemy on the other.
    const ally = game.spawnUnit("enemy", "footman", mine.x + 60, mine.y);
    const foe = game.spawnUnit("enemy2", "footman", mine.x - 60, mine.y);
    const snapshot = snapshotGame(game);
    expect(rightClick(snapshot, [worker], ally)).toEqual({ type: "follow", unitIds: [worker.id], targetId: ally.id, queued: false });
    expect(rightClick(snapshot, [worker], foe)).toEqual({ type: "attack", unitIds: [worker.id], targetId: foe.id, queued: false });
    expect(rightClick(snapshot, [worker, soldier], mine)).toEqual({ type: "mine", unitIds: [worker.id], resourceId: mine.id, queued: false });
    // A soldier has nothing to do at a mine: a move there.
    expect(rightClick(snapshot, [soldier], mine)).toBeUndefined();
  });

  it("walks to an ally's building, and attacks an enemy's, the creeps and rocks", () => {
    const { game, own } = alliedGame();
    const snapshot = snapshotGame(game);
    const hall = (owner: string) => snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
    expect(rightClick(snapshot, [own], hall("enemy"))).toBeUndefined();
    expect(rightClick(snapshot, [own], hall("enemy2"))).toMatchObject({ type: "attack", targetId: hall("enemy2").id });
    const creep = snapshot.units.find((unit) => unit.owner === "neutral")!;
    expect(rightClick(snapshot, [own], creep)).toMatchObject({ type: "attack", targetId: creep.id });
    const rocks = { id: "rocks-1", kind: "rocks" as const, owner: "neutral" as const, x: 300, y: 300, radius: 40, hp: 500, maxHp: 500, along: { x: 1, y: 0 } };
    expect(rightClick({ ...snapshot, obstacles: [rocks] }, [own], { x: 330, y: 300 })).toMatchObject({ type: "attack", targetId: rocks.id });
  });

  it("tells own, allied, enemy and creep owners apart", () => {
    const snapshot = snapshotGame(alliedGame().game);
    expect(["player", "enemy", "enemy2", "neutral"].map((owner) => relationTo(snapshot, "player", owner as never))).toEqual(["own", "ally", "enemy", "creep"]);
    // Without teams (a duel, an old save), every other player is an enemy.
    expect(relationTo({}, "player", "enemy")).toBe("enemy");
  });

  it("knows a player with an ally, for whom the minimap starts in friend-or-foe colours", () => {
    const snapshot = snapshotGame(alliedGame().game);
    expect(hasAlly(snapshot, "player")).toBe(true);
    expect(hasAlly(snapshot, "enemy2")).toBe(false);
    expect(hasAlly(snapshotGame(createGame("bareDuel", { aiPlayers: [] })), "player")).toBe(false);
  });
});

it('treats an empty hostile deck as walkable ground while defenders remain attack targets',()=>{
  const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];delete game.map.terrain;
  const own=game.spawnUnit('player','transport',700,700),enemy=game.spawnUnit('enemy','transport',880,700),crew=game.spawnUnit('player','footman',700,700);
  boardUnit(own,crew,game.units);syncDecks(game.units);
  const snapshot=snapshotGame(game),point={x:enemy.x,y:enemy.y-deckVisualHeight(enemy)};
  expect(pointerTarget(snapshot,point)).toMatchObject({kind:'unit',unit:{id:enemy.id}});
  expect(targetCommand(snapshot,'player',[crew],{kind:'unit',unit:enemy})).toMatchObject({type:'board',transportId:enemy.id,unitIds:[crew.id]});
  expect(deckMovePoint(game.units,[crew],point)).toEqual({x:enemy.x,y:enemy.y});
  const defender=game.spawnUnit('enemy','footman',enemy.x,enemy.y);boardUnit(enemy,defender,game.units);syncDecks(game.units);
  expect(targetCommand(snapshotGame(game),'player',[crew],{kind:'unit',unit:defender})).toMatchObject({type:'attack',targetId:defender.id});
});

describe("gold mine click boundaries", () => {
  it("leaves bare ground beside the mine available for movement", () => {
    const game=createGame("bareDuel");game.units=[];game.buildings=[];game.items=[];game.obstacles=[];
    const mine=game.resources[0]!;
    expect(pointerTarget(snapshotGame(game),mine)?.kind).toBe("resource");
    for(const dx of [-83,-55,55,83])expect(pointerTarget(snapshotGame(game),{x:mine.x+dx,y:mine.y})).toBeUndefined();
  });
});

// @@@tower-garrison - A right-click on an own fortified tower sends the selection up; its troops are pointed at on its top.
it('sends troops up an own fortified tower and points at them on its top', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = [];
  const tower = createBuilding('tower', 'player', 'defenseTower', 1500, 1500, true);
  game.buildings.push(tower);
  const archer = game.spawnUnit('player', 'archer', 1500, 1700), worker = game.spawnUnit('player', 'worker', 1540, 1700);
  expect(targetCommand(snapshotGame(game), 'player', [archer], { kind: 'building', building: tower })).toBeUndefined();
  tower.kind = 'fortifiedTower';
  expect(targetCommand(snapshotGame(game), 'player', [archer, worker], { kind: 'building', building: tower })).toEqual({ type: 'garrison', unitIds: [archer.id, worker.id], buildingId: tower.id, queued: false });
  tower.hp -= 50;
  expect(targetCommand(snapshotGame(game), 'player', [archer, worker], { kind: 'building', building: tower })).toMatchObject({ type: 'repair', unitIds: [worker.id] });
  archer.garrison = { buildingId: tower.id }; archer.x = tower.x - 14; archer.y = tower.y - 14;
  const snapshot = snapshotGame(game), point = unitPointerPosition(snapshot.units, archer, false, snapshot.buildings);
  expect(point.y).toBeLessThan(archer.y - 30);
  expect(pointerTarget(snapshot, point)).toMatchObject({ kind: 'unit', unit: { id: archer.id } });
});

describe("an attack on a target across water (see @@@context-reach)", () => {
  // Columns 10 to 14 are deep water: 160 across, beyond a footman's reach and within an archer's.
  function channel(width: number) {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
    game.units = [];
    game.map = { ...game.map, width: 1280, height: 1280, terrain: { cell: 32, cols: 40, rows: 40, cells: Array.from({ length: 1600 }, (_, at) => (at % 40 >= 10 && at % 40 < 10 + width ? "~" : ".")).join("") } };
    const footman = game.spawnUnit("player", "footman", 200, 640), archer = game.spawnUnit("player", "archer", 260, 640);
    return { game, footman, archer };
  }

  it("goes to the units that can strike it, and leaves the rest to walk", () => {
    const { game, footman, archer } = channel(5);
    const foe = game.spawnUnit("enemy", "footman", 15.5 * 32, 640);
    expect(targetCommand(snapshotGame(game), "player", [footman, archer], { kind: "unit", unit: foe })).toEqual({ type: "attack", unitIds: [archer.id], targetId: foe.id, queued: false });
  });

  it("is refused when none can, instead of an attack nobody carries out", () => {
    const { game, footman, archer } = channel(20);
    const foe = game.spawnUnit("enemy", "footman", 1100, 640);
    expect(targetCommand(snapshotGame(game), "player", [footman, archer], { kind: "unit", unit: foe })).toEqual({ refusal: "unreachable" });
  });
});

// Ineligible members reach the shared command check so each gets a specific refusal, rather than a silent move.
it("keeps a mechanical tower click as an explicit garrison request", () => {
  const game = createGame("bareDuel", { aiPlayers: [] });
  const tower = createBuilding("tower", "player", "fortifiedTower", 1000, 1000, true);
  game.buildings.push(tower);
  const ballista = game.spawnUnit("player", "ballista", 1000, 1100);
  expect(targetCommand(snapshotGame(game), "player", [ballista], { kind: "building", building: tower })).toEqual({ type: "garrison", unitIds: [ballista.id], buildingId: tower.id, queued: false });
});

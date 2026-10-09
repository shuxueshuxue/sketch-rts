import { restoreCargoDecks, boardUnit } from "../../shared/decks";
import { describe, expect, it } from "vitest";
import { createUnit } from "../../shared/map";
import { createGame, issuePlayerCommand, snapshotGame as rawSnapshotGame, stepGame } from "../../shared/sim";
import { isShoreFootprint, isWalkable, sameGround, type Terrain } from "../../shared/terrain";
import { createAiPolicyMemory } from "../memory";
import { desiredExpansionMine } from "./expansion-model";
import { navalUnitIds, navalWant, navalBudgetReserve, planNavalTactics } from "./naval";
import { nextExpansionMine, readV6Intel } from "./v6/intel";
import { projectedSupplyUsed } from "./world-model";
import { installedWeapons, shipPartMax } from '../../shared/ship-equipment';
import { headingDifference, planShipRoute } from '../../shared/ship-navigation';
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from '../runtime';
import { CommandFrameRuntime } from '../../shared/sim/command-frame-runtime';
import { seconds } from '../../shared/time';
import { runAiCommandEntriesFromScripts } from './script-runner';
import { planNavalEconomy } from './naval';
import { frozenPolicyModules } from '../../../scripts/bootstrap_1-planner';

// Tests that model old cargo saves observe the same restored live crew as the runtime.
function snapshotGame(game: ReturnType<typeof createGame>) {
  restoreCargoDecks(game.units);
  return rawSnapshotGame(game);
}

// A 30 by 20 grid: land in columns 0-8, shallows down column 9, the sea beyond, and in it an island (columns 20-24, rows
// 7-12) ringed with shallows.
function coast(): Terrain {
  let cells = "";
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 30; col += 1) {
      const island = col >= 20 && col <= 24 && row >= 7 && row <= 12;
      const rim = col >= 19 && col <= 25 && row >= 6 && row <= 13;
      cells += col <= 8 || island ? "." : col === 9 || rim ? "," : "~";
    }
  }
  return { cell: 32, cols: 30, rows: 20, cells };
}

const at = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 });

// The player holds two halls on the land with workers mining; the only other mine is the island's.
function islandGame(terrain = coast(), players = ["player", "enemy"]) {
  const game = createGame("bareDuel", {
    players,
    scenario: {
      players: { player: { gold: 1_000 } },
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      replaceDefaultResources: true,
      replaceDefaultMercenaryCamps: true,
      replaceDefaultLandmarks: true,
      addBuildings: [
        { id: "hall-a", owner: "player", kind: "townHall", ...at(3, 3) },
        { id: "hall-b", owner: "player", kind: "townHall", ...at(3, 15) },
        { id: "farm", owner: "player", kind: "farm", ...at(5, 18) },
      ],
      addResources: [
        { id: "main", kind: "goldMine", ...at(1, 3), amount: 6_000 },
        { id: "natural", kind: "goldMine", ...at(1, 15), amount: 6_000 },
        { id: "island", kind: "goldMine", ...at(22, 9), amount: 6_000 },
      ],
      addUnits: [
        { id: "w1", owner: "player", kind: "worker", ...at(2, 4), order: { type: "mine", resourceId: "main", phase: "toMine", timer: 0 } },
        { id: "w2", owner: "player", kind: "worker", ...at(2, 14), order: { type: "mine", resourceId: "natural", phase: "toMine", timer: 0 } },
      ],
    },
  });
  game.map = { ...game.map, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell, terrain };
  for(let i=3;i<=6;i++)game.units.push({...createUnit(`w${i}`,"player","worker",at(3,4+i).x,at(3,4+i).y),order:{type:"mine",resourceId:"main",phase:"toMine",timer:0}});
  return game;
}

describe('shared dock outfitting', () => {
  it.each([10, 0])('distinguishes a turning ferry from a stalled ferry with rudder=%s', rudder => {
    const terrain = coast();
    terrain.rows += 40;
    terrain.cells += ('.........,' + '~'.repeat(20)).repeat(40);
    const game = islandGame(terrain);
    game.buildings.push({ ...game.buildings[0]!, id: 'foe-hall', owner: 'enemy', ...at(4, 12) });
    const boat = game.spawnUnit('player', 'transport', at(15, 35).x, at(15, 35).y);
    const passenger = game.spawnUnit('player', 'footman', boat.x, boat.y);
    expect(boardUnit(boat, passenger, game.units)).toBe(true);
    boat.sailing!.heading = Math.PI;
    // Preserve a real precise turn planned before the rudder damage. The
    // passenger cannot repair the helm; the simulation must execute the turn.
    const berth = { x: boat.x, y: boat.y };
    const planned = planShipRoute(game.map, boat, { ...berth, heading: 0 });
    expect(planned.points.length).toBeGreaterThan(0);
    boat.shipParts = { ...shipPartMax(boat), rudder };
    issuePlayerCommand(game, 'player', { type: 'unload', unitIds: [boat.id], ...berth });
    boat.sailing!.route = { ...planned, goalX: berth.x, goalY: berth.y, end: planned.points.at(-1)!,
      startX: boat.x, startY: boat.y, startHeading: Math.PI, cruise: false };
    const memory = createAiPolicyMemory();
    memory.naval = { ferries: { [boat.id]: { purpose: 'rebase', targetId: 'island', from: at(9, 35), to: berth,
      phase: 'sailing', crewIds: [], sinceTick: game.tick } } };
    let returned = false;
    for (let tick = 0; tick < seconds(45); tick++) {
      if (tick % 15 === 0) {
        for (const command of planNavalTactics(snapshotGame(game), 'player', { version: 'v8', memory })) issuePlayerCommand(game, 'player', command);
        if (memory.naval.ferries![boat.id]!.phase === 'return') { returned = true; break; }
      }
      stepGame(game);
    }
    if (rudder === 0) {
      expect(returned).toBe(true);
      expect(game.tick).toBeGreaterThan(seconds(40));
      expect(boat.sailing!.heading).toBe(Math.PI);
    } else {
      expect(returned).toBe(false);
      expect(Math.hypot(boat.x - berth.x, boat.y - berth.y)).toBeLessThan(.1);
      expect(Math.abs(headingDifference(Math.PI, boat.sailing!.heading))).toBeGreaterThan(1.5);
      expect(memory.naval.ferries![boat.id]!.phase).toBe('sailing');
    }
  });

  it('keeps an embarked colony sailing when casualties have lowered population below the opening gate', async () => {
    const game = islandGame();
    game.buildings = game.buildings.filter(building => building.id !== 'hall-b');
    game.resources = game.resources.filter(mine => mine.id !== 'natural');
    game.buildings.push({ ...game.buildings[0]!, id: 'foe-hall', owner: 'enemy', ...at(5, 12) });
    const boat = game.spawnUnit('player', 'transport', at(12, 9).x, at(12, 9).y);
    expect(boardUnit(boat, game.units[0]!, game.units)).toBe(true);
    stepGame(game);
    const memory = createAiPolicyMemory();
    memory.naval = {
      island: { tick: game.tick, plan: { mineId: 'island', landing: at(19, 9) } },
      ferries: { [boat.id]: { purpose: 'settle', targetId: 'island', from: at(9, 9), to: at(19, 9), phase: 'sailing',
        crewIds: [], sinceTick: game.tick } },
    };
    const snapshot = snapshotGame(game);
    expect(snapshot.players.player!.supplyUsed).toBeLessThan(20);
    const historical = await frozenPolicyModules(), oldMemory = structuredClone(memory);
    historical.planAiOwnerCommandEntries(snapshot, { playerId: 'player', version: 'v8', scriptIds: ['naval'] },
      { memory: oldMemory, teams: game.teams });
    expect(oldMemory.naval!.ferries![boat.id]!.phase).toBe('return');
    const commands = planNavalTactics(snapshot, 'player', { version: 'v8', memory });
    expect(memory.naval.ferries![boat.id]!.phase).toBe('sailing');
    expect(commands).toContainEqual({ type: 'unload', unitIds: [boat.id], ...at(19, 9) });
    for (const command of commands) issuePlayerCommand(game, 'player', command);
    const before = boat.x;
    for (let tick = 0; tick < 40; tick++) stepGame(game);
    expect(boat.x).toBeGreaterThan(before);
  }, 15000);

  it('reconsiders its cached mine after an expedition stalls and returns', () => {
    const game = islandGame();
    const boat = game.spawnUnit('player', 'transport', at(12, 9).x, at(12, 9).y);
    const worker = game.units[0]!;
    expect(boardUnit(boat, worker, game.units)).toBe(true);
    const memory = createAiPolicyMemory();
    memory.naval = {
      island: { tick: 0, plan: { mineId: 'island', landing: at(19, 9) } },
      ferries: { [boat.id]: { purpose: 'settle', targetId: 'island', from: at(9, 9), to: at(19, 9), phase: 'loading', crewIds: [], sinceTick: 0,
        progress: { tick: 0, x: boat.x, y: boat.y, heading: boat.sailing!.heading, phase: 'loading', crew: worker.id } } }
    };
    game.tick = seconds(41);
    const commands = planNavalTactics(snapshotGame(game), 'player', { version: 'v8', memory });
    expect(memory.naval.ferries![boat.id]!.phase).toBe('return');
    expect(commands.some(command => command.type === 'unload')).toBe(true);
    expect(memory.naval.island).toBeUndefined();
  });

  it('requests the population prerequisite when a full land army blocks its ferry', () => {
    const game = islandGame();
    game.buildings.push({ ...game.buildings[0]!, id: 'yard', kind: 'shipyard', x: 275, y: 336, radius: 44 });
    game.players.player.supplyCap = 8;
    game.spawnUnit('player', 'footman', 140, 200);
    const want = navalWant(snapshotGame(game), 'player', { version: 'v5', memory: createAiPolicyMemory() });
    expect(want?.id).toBe('naval:population');
    expect(want?.issue(new Set())).toMatchObject({ type: 'build', buildingKind: 'farm' });
  });

  it('lets naval purchases spend their earmarked ferry budget after depletion', () => {
    const game = islandGame();
    for (const mine of game.resources) if (mine.id !== 'island') mine.amount = 0;
    game.players.player.gold = 610;
    game.buildings.push({ ...game.buildings[0]!, id: 'yard', kind: 'shipyard', x: 275, y: 336, radius: 44 });
    const options = { version: 'v5' as const, memory: createAiPolicyMemory() };
    const snapshot = snapshotGame(game);
    expect(navalBudgetReserve(snapshot, 'player', options)).toBeGreaterThan(0);
    const commands = runAiCommandEntriesFromScripts(snapshot, 'player', [{ id: 'navalEconomy', phase: 'economy', run: planNavalEconomy }], options);
    expect(commands).toContainEqual({ scriptId: 'navalEconomy', command: { type: 'train', buildingId: 'yard', unitKind: 'transport' } });
  });

  for(const version of ['v5','v7','v8'] as const)it(`${version} adds a working broadside battery to an important crewed warship`,()=>{
    const game=islandGame();game.scriptedVictory=true;game.players.player!.gold=3000;
    game.buildings.push({...game.buildings[0]!,id:'battery-yard',kind:'shipyard',x:275,y:336,radius:44,complete:true});
    const ship=game.spawnUnit('player','warship',400,336),crew=game.spawnUnit('player','footman',400,336);
    expect(boardUnit(ship,crew,game.units)).toBe(true);
    for(let i=0;i<6;i++)game.spawnUnit('player','footman',130,100+i*40);
    const options={version,memory:createAiPolicyMemory()};
    for(let tick=0;tick<seconds(40)&&installedWeapons(game,ship).length<3;tick++){
      const snapshot=snapshotGame(game),want=navalWant(snapshot,'player',options);
      if(want?.id==='naval:gun'){const command=want.issue(new Set());if(command)issuePlayerCommand(game,'player',command);}
      for(const command of planNavalTactics(snapshotGame(game),'player',options))issuePlayerCommand(game,'player',command);
      stepGame(game);
    }
    expect(installedWeapons(game,ship)).toHaveLength(3);
    expect(new Set(installedWeapons(game,ship).map(gun=>gun.mountId)).size).toBe(3);
    expect(crew.deck?.shipId).toBe(ship.id);
  });
  for(const version of ['v5','v7','v8'] as const)it(`${version} completes a real island colony and puts its settlers to work`,()=>{
    // The island fits a hall outside the ordinary 280-unit hauling distance.
    const terrain=coast();terrain.cols=36;
    terrain.cells=Array.from({length:terrain.rows},(_,row)=>Array.from({length:terrain.cols},(_,col)=>
      col<=8 || col>=20 && col<=33 && row>=5 && row<=14 ? '.' : col===9 || col>=19 && col<=34 && row>=4 && row<=15 ? ',' : '~').join('')).join('');
    const game=islandGame(terrain);game.scriptedVictory=true;
    game.players.player!.gold=3000;
    game.buildings.push({...game.buildings[0]!,id:'colony-yard',kind:'shipyard',x:275,y:336,radius:44,complete:true});
    game.spawnUnit('player','transport',400,336);
    const ai=createAiRuntime(['player'],{version});
    const runtime=new CommandFrameRuntime({game,roomId:'colony-test',rejectionLabel:'colony-test',aiPlanner:createPresetAiRuntimeFramePlanner(game,ai)});
    let arrived=false,mined=false,colony=false;
    const mine=game.resources.find(m=>m.id==='island')!;
    for(let tick=0;tick<seconds(240) && !(mined&&colony);tick++){
      runtime.tick();
      arrived ||= game.units.some(u=>u.kind==='worker' && !u.deck && sameGround(game.map,u,mine));
      mined ||= game.units.some(u=>u.kind==='worker' && u.order.type==='mine' && u.order.resourceId===mine.id && u.carryingGold>0);
      colony ||= game.buildings.some(b=>b.kind==='townHall' && b.complete && sameGround(game.map,b,mine));
    }
    const diagnostic=JSON.stringify({naval:ai.memories.player?.naval,gold:game.players.player!.gold,units:game.units.map(u=>({id:u.id,kind:u.kind,x:u.x,y:u.y,deck:u.deck,order:u.order})),buildings:game.buildings.map(b=>({kind:b.kind,x:b.x,y:b.y,complete:b.complete}))});
    expect(arrived,diagnostic).toBe(true);expect(colony,diagnostic).toBe(true);expect(mined,diagnostic).toBe(true);
  },20000);
  for (const version of ['v5','v7','v8'] as const) it(`${version} buys directly into the hold and installs without needing a crew member`, () => {
    const game = islandGame(); game.scriptedVictory = true; game.players.player!.gold = 3000;
    const dock = {...game.buildings[0]!,id:'outfit-yard',kind:'shipyard' as const,x:275,y:336,radius:44,complete:true}; game.buildings.push(dock);
    const ship = game.spawnUnit('player','transport',400,336);
    game.units=game.units.filter(unit=>unit.kind!=='worker');
    for (let i=0;i<6;i++) game.spawnUnit('player','footman',130,100+i*40);
    const options = {version,memory:createAiPolicyMemory()};
    expect(navalUnitIds(snapshotGame(game),'player',options).has(ship.id)).toBe(true);
    const want = navalWant(snapshotGame(game),'player',options);
    expect(want?.id).toBe('naval:gun');
    const purchase = want!.issue(new Set())!;
    expect(purchase.type).toBe('buyShipEquipment');
    expect(purchase).toMatchObject({recipientId:ship.id});
    issuePlayerCommand(game,'player',purchase);
    const gun = game.items.find(item=>item.kind==='shipCannon')!;
    expect(gun).toMatchObject({shipId:ship.id,holdSlot:0});
    let hauled = false;
    for (let tick=0;tick<1500 && !installedWeapons(game,ship).length;tick++) {
      for (const command of planNavalTactics(snapshotGame(game),'player',options)) issuePlayerCommand(game,'player',command);
      if (gun.carrierId) hauled=true;
      stepGame(game);
    }
    expect(hauled).toBe(false);
    expect(installedWeapons(game,ship).map(item=>item.id)).toEqual([gun.id]);
    expect(game.items.filter(item=>item.kind==='shipCannon')).toHaveLength(1);
    expect(game.units.some(unit=>unit.kind==='worker')).toBe(false);
  });
});

// A 30 by 20 grid of land with water in columns 10-19, rows 2-17 (a lake, or with `pond` a pond of four cells there): the
// land is one whole round it. The player holds two halls west of it, the enemy a hall east of it with a worker by it.
function lakeGame(pond = false, tower = false) {
  let cells = "";
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 30; col += 1) cells += (pond ? col >= 18 && col <= 19 && row >= 8 && row <= 9 : col >= 10 && col <= 19 && row >= 2 && row <= 17) ? "~" : ".";
  }
  const terrain: Terrain = { cell: 32, cols: 30, rows: 20, cells };
  const game = createGame("bareDuel", {
    players: ["player", "enemy"],
    scenario: {
      players: { player: { gold: 1_000 } },
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      replaceDefaultResources: true,
      replaceDefaultMercenaryCamps: true,
      replaceDefaultLandmarks: true,
      addBuildings: [
        { id: "hall-a", owner: "player", kind: "townHall", ...at(3, 3) },
        { id: "hall-b", owner: "player", kind: "townHall", ...at(3, 15) },
        { id: "farm", owner: "player", kind: "farm", ...at(5, 18) },
        { id: "hall-e", owner: "enemy", kind: "townHall", ...at(24, 9) },
        ...(tower ? [{ id: "tower-e", owner: "enemy", kind: "defenseTower" as const, ...at(21, 6) }] : []),
      ],
      addResources: [
        { id: "main", kind: "goldMine", ...at(1, 3), amount: 6_000 },
        { id: "natural", kind: "goldMine", ...at(1, 15), amount: 6_000 },
        { id: "enemy-main", kind: "goldMine", ...at(27, 9), amount: 6_000 },
      ],
      addUnits: [
        { id: "w1", owner: "player", kind: "worker", ...at(2, 4), order: { type: "mine", resourceId: "main", phase: "toMine", timer: 0 } },
        { id: "w2", owner: "player", kind: "worker", ...at(2, 14), order: { type: "mine", resourceId: "natural", phase: "toMine", timer: 0 } },
        { id: "we", owner: "enemy", kind: "worker", ...at(21, 10) },
      ],
    },
  });
  game.map = { ...game.map, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell, terrain };
  return game;
}

describe("the AI on the water", () => {
  it("has an escort protect a loaded ferry instead of chasing a coastal economic target", () => {
    const game = islandGame();
    const boat = createUnit("ferry", "player", "transport", at(13, 9).x, at(13, 9).y);
    boat.cargo = [createUnit("passenger", "player", "footman", 0, 0)];
    const guard = createUnit("escort", "player", "warship", at(12, 9).x, at(12, 9).y);
    const attacker = createUnit("raider", "enemy", "cutter", at(15, 9).x, at(15, 9).y);
    attacker.order = { type: "attack", targetId: boat.id };
    game.units.push(boat, guard, attacker);
    game.buildings.push({ ...game.buildings[0]!, id: "coastal-farm", owner: "enemy", kind: "farm", ...at(8, 9) });
    const commands = planNavalTactics(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() });
    expect(commands).toContainEqual({ type: "attackMove", unitIds: ["escort"], x:attacker.x, y:attacker.y });
    for (const command of commands.filter(command => command.type === "attackMove")) issuePlayerCommand(game, "player", command);
    for (let tick = 0; tick < 80; tick++) stepGame(game);
    expect(game.units.find(unit => unit.id === "raider")?.hp ?? 0).toBeLessThan(attacker.maxHp);
  });

  it("sends a loading convoy's escort ahead to cover the landing instead of waiting on the boat", () => {
    const game = islandGame();
    const boat = createUnit("ferry", "player", "transport", at(9, 9).x, at(9, 9).y);
    boat.cargo = [createUnit("passenger", "player", "footman", 0, 0)];
    const guard = createUnit("escort", "player", "warship", at(10, 9).x, at(10, 9).y);
    game.units.push(boat, guard);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    options.memory.naval = { ferries: { ferry: { purpose: "settle", targetId: "island", from: at(9, 9), to: at(19, 9), phase: "loading", crewIds: [], sinceTick: 0 } } };
    const command = planNavalTactics(snapshotGame(game), "player", options).find(command => command.type === "move" && command.unitIds.includes("escort"));
    expect(command?.type).toBe("move");
    if (command?.type !== "move") throw new Error("escort did not advance");
    expect(command.x).toBeGreaterThan(boat.x + 200);
  });

  it("releases overseas savings when its local base needs defending", () => {
    const game = islandGame();
    game.resources.find(mine => mine.id === "main")!.amount = 50;
    game.resources.find(mine => mine.id === "natural")!.amount = 50;
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    expect(navalBudgetReserve(snapshotGame(game), "player", options)).toBeGreaterThan(0);
    game.units.push(createUnit("intruder", "enemy", "footman", at(6, 3).x, at(6, 3).y));
    expect(navalBudgetReserve(snapshotGame(game), "player", options)).toBe(0);
  });

  it("brings passengers home when an assault target disappears instead of leaving a loaded boat idle", () => {
    const game = islandGame();
    game.scriptedVictory = true;
    const boat = createUnit("ferry", "player", "transport", at(12, 9).x, at(12, 9).y);
    boat.cargo = [createUnit("passenger", "player", "footman", 0, 0)];
    game.units.push(boat);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    options.memory.naval = { ferries: { ferry: { purpose: "assault", targetId: "destroyed-hall", from: at(9, 9), to: at(19, 9), phase: "sailing", crewIds: [], sinceTick: 0 } } };
    expect(planNavalTactics(snapshotGame(game), "player", options)).toContainEqual({ type: "unload", unitIds: ["ferry"], ...at(9, 9), avoidCombat:true });
    expect(options.memory.naval.ferries!.ferry!.phase).toBe("return");
    for (const command of planNavalTactics(snapshotGame(game), "player", options)) issuePlayerCommand(game, "player", command);
    for (let tick = 0; tick < 500; tick++) stepGame(game);
    const passenger = game.units.find(unit => unit.id === "passenger");
    expect(passenger).toBeDefined();
    expect(sameGround(game.map, passenger!, game.buildings[0]!)).toBe(true);
    planNavalTactics(snapshotGame(game), "player", options);
    expect(options.memory.naval.ferries!.ferry).toBeUndefined();
  });

  it("turns back from an assault whose landing has become much stronger", () => {
    const game = islandGame();
    game.buildings.push({ ...game.buildings[0]!, id: "enemy-hall", owner: "enemy", ...at(22, 9) });
    for (let i = 0; i < 4; i++) game.units.push(createUnit(`defender-${i}`, "enemy", "knight", at(22, 9).x, at(22, 9).y + i * 25));
    const boat = createUnit("ferry", "player", "transport", at(12, 9).x, at(12, 9).y);
    boat.cargo = [createUnit("passenger", "player", "footman", 0, 0)];
    game.units.push(boat);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    options.memory.naval = { ferries: { ferry: { purpose: "assault", targetId: "enemy-hall", from: at(9, 9), to: at(19, 9), phase: "sailing", crewIds: [], sinceTick: 0 } } };
    expect(planNavalTactics(snapshotGame(game), "player", options)).toContainEqual({ type: "unload", unitIds: ["ferry"], ...at(9, 9), avoidCombat:true });
    expect(options.memory.naval.ferries!.ferry!.phase).toBe("return");
  });

  it("buys more transport capacity when a full ferry cannot carry the army needed for the landing", () => {
    const game = islandGame();
    game.players.player!.supplyCap = 100;
    const hall = game.buildings[0]!;
    game.buildings.push({ ...hall, id: "enemy-hall", owner: "enemy", ...at(22, 9) });
    game.buildings.push({ ...hall, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 });
    for (let i = 0; i < 12; i++) game.units.push(createUnit(`army-${i}`, "player", "knight", at(3, 8).x, at(3, 8).y + i * 10));
    for (let i = 0; i < 4; i++) game.units.push(createUnit(`defender-${i}`, "enemy", "footman", at(22, 9).x, at(22, 9).y + i * 10));
    const boat = createUnit("ferry", "player", "transport", at(9, 9).x, at(9, 9).y);
    boat.cargo = [createUnit("passenger", "player", "knight", 0, 0)];
    game.units.push(boat);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    options.memory.naval = { ferries: { ferry: { purpose: "assault", targetId: "enemy-hall", from: at(9, 9), to: at(19, 9), phase: "loading", crewIds: [], sinceTick: 0 } } };
    const want = navalWant(snapshotGame(game), "player", options);
    expect(want?.id).toBe("naval:carrier");
    expect(want?.issue(new Set())).toMatchObject({ type: "train", unitKind: "carrier", buildingId: "yard" });
  });

  it("evacuates an isolated soldier and engineers from an island they cannot hold", () => {
    const game = islandGame();
    game.units.push(createUnit("ferry", "player", "transport", at(18, 9).x, at(18, 9).y));
    game.units.push(createUnit("stranded", "player", "footman", at(21, 9).x, at(21, 9).y));
    game.units.push(createUnit("engineer", "player", "worker", at(21, 10).x, at(21, 10).y));
    for (let i = 0; i < 4; i++) game.units.push(createUnit(`invader-${i}`, "enemy", "knight", at(24, 9).x, at(24, 9).y + i * 15));
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const commands = planNavalTactics(snapshotGame(game), "player", options);
    expect(options.memory.naval?.ferries?.ferry?.purpose).toBe("evacuate");
    // The boat may first approach the departure shore. Once alongside, it boards the threatened group.
    const mission = options.memory.naval!.ferries!.ferry!;
    const boat = game.units.find(unit => unit.id === "ferry")!;
    boat.x = mission.from.x;
    boat.y = mission.from.y;
    const boarding = [...commands, ...planNavalTactics(snapshotGame(game), "player", options)].filter(command => command.type === "board");
    expect(boarding.flatMap(command => command.unitIds)).toEqual(expect.arrayContaining(["stranded", "engineer"]));
  });

  it("wants a shipyard on its own shore for an island's mine once it holds two bases", () => {
    const game = islandGame();
    const snapshot = snapshotGame(game);
    const want = navalWant(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() })!;
    expect(want.id).toBe("naval:shipyard");
    const command = want.issue(new Set());
    expect(command).toMatchObject({ type: "build", buildingKind: "shipyard" });
    if (command?.type !== "build") throw new Error("no build");
    expect(isShoreFootprint(snapshot.map, command.x, command.y, 44)).toBe(true);
    expect(command.x).toBeLessThan(at(10, 0).x);
    // Every live policy shares the same terrain-driven naval capability.
    expect(navalWant(snapshot, "player", { version: "v2", requestedVersion: "v9", memory: createAiPolicyMemory() })?.id).toBe("naval:shipyard");
  });

  it("raises its shipyard on a shore no enemy tower covers", () => {
    const game = islandGame();
    const tower = { ...game.buildings.find((building) => building.id === "hall-a")!, id: "tower-e", owner: "enemy" as const, kind: "defenseTower" as const, ...at(7, 0), radius: 22, complete: true };
    game.buildings.push(tower);
    const command = navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.issue(new Set());
    if (command?.type !== "build") throw new Error("no shipyard");
    expect(Math.hypot(command.x - tower.x, command.y - tower.y)).toBeGreaterThan(480 + 44);
  });

  it("raises no shipyard under its own tower within reach of an enemy warship the tower does not reach", () => {
    const game = islandGame();
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "tower", kind: "defenseTower", ...at(5, 3), radius: 22, complete: true });
    const ship = { ...game.units.find((unit) => unit.id === "w1")!, id: "e-ship", owner: "enemy" as const, kind: "warship" as const, ...at(22, 3), order: { type: "idle" as const }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 };
    game.units.push(ship);
    const command = navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.issue(new Set());
    if (command?.type !== "build" || command.buildingKind !== "shipyard") throw new Error("no shipyard");
    expect(Math.hypot(command.x - ship.x, command.y - ship.y)).toBeGreaterThan(390 + 44 + 100);
  });

  it("builds an escort instead of abandoning contested water", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame();
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 });
    const enemyShip = (id: string, col: number) => ({ ...game.units.find((unit) => unit.id === "w1")!, id, owner: "enemy" as const, kind: "warship" as const, ...at(col, 17), order: { type: "idle" as const }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 });
    game.units.push(enemyShip("e1", 14));
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:warship");
    game.units.push(enemyShip("e2", 16));
    expect(navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.id).toBe("naval:warship");
  });

  it("breaks a blockade in the closeout: another warship, and no transport, until its fleet outweighs the enemy's", () => {
    const game = islandGame();
    const hall = game.buildings.find((building) => building.id === "hall-a")!;
    game.buildings.push({ ...hall, id: "hall-e", owner: "enemy", ...at(22, 10) }, { ...hall, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 });
    const warship = (id: string, owner: "player" | "enemy", col: number) => ({ ...game.units.find((unit) => unit.id === "w1")!, id, owner, kind: "warship" as const, ...at(col, 16), order: { type: "idle" as const }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 });
    game.units.push(warship("p1", "player", 11), warship("p2", "player", 12), warship("e1", "enemy", 26), warship("e2", "enemy", 27));
    expect(navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.id).toBe("naval:warship");
    // Its fleet outweighing theirs, the transport comes.
    game.units.push(warship("p3", "player", 13), warship("p4", "player", 14));
    expect(navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.id).toBe("naval:transport");
  });

  it("keeps its idle warships off the shallows its workers cross to the island", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame();
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 });
    game.units.push({ ...game.units.find((unit) => unit.id === "w1")!, id: "ship", kind: "warship", ...at(12, 3), order: { type: "idle" }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 });
    const station = planNavalTactics(snapshotGame(game), "player", options).find((command) => command.type === "move" && command.unitIds.includes("ship"));
    if (station?.type !== "move") throw new Error("no station");
    expect(isWalkable(game.map, station.x, station.y, "sea")).toBe(true);
    expect(isWalkable(game.map, station.x, station.y)).toBe(false);
  });

  it("never sends its workers to expand to a mine they cannot walk to", () => {
    const game = islandGame();
    // One hall, and no mine left on its land: by a straight line the island's is the next.
    game.buildings = game.buildings.filter((building) => building.id !== "hall-b");
    game.resources = game.resources.filter((mine) => mine.id !== "natural");
    const snapshot = snapshotGame(game);
    expect(desiredExpansionMine(snapshot, "player")).toBeUndefined();
    expect(nextExpansionMine(snapshot, readV6Intel(snapshot, "player", { version: "v8" }))).toBeUndefined();
  });

  it("crosses to an opponent's island hall while it still stands ashore: against it alone at once, against more with its general's edge (see @@@transport-attack)", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame(coast(), ["player", "enemy", "rival"]);
    // One hall of its own: nothing on the water but the crossing (no island to take, no raid without a second base).
    game.resources = game.resources.filter((mine) => mine.id !== "island");
    game.buildings = game.buildings.filter((building) => building.id !== "hall-b");
    const hall = game.buildings.find((building) => building.id === "hall-a")!;
    game.buildings.push({ ...hall, id: "enemy-island", owner: "enemy", ...at(22, 9) }, { ...hall, id: "enemy-shore", owner: "enemy", ...at(6, 9) });
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:shipyard");
    // A second opponent ashore, and soldiers on the island the player has none to outweigh: no crossing.
    const footman = game.units.find((unit) => unit.id === "w1")!;
    game.buildings.push({ ...hall, id: "rival-shore", owner: "rival", ...at(6, 17) });
    game.units.push(...[8, 10].map((row) => ({ ...footman, id: `guard-${row}`, owner: "enemy", kind: "footman" as const, ...at(21, row), order: { type: "idle" as const }, radius: 18 })));
    // A naval raid remains possible; transporting the outmatched land army does not.
    expect(planNavalTactics(snapshotGame(game),"player",{version:"v8",memory:createAiPolicyMemory()}).some(command=>command.type==="board")).toBe(false);
  });

  it("assaults an enemy's last base on an island: a transport first, idle soldiers aboard, the landed at its hall", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame();
    game.resources = game.resources.filter((mine) => mine.id !== "island");
    game.buildings.push(
      { ...game.buildings.find((building) => building.id === "hall-a")!, id: "enemy-hall", owner: "enemy", x: at(22, 9).x, y: at(22, 9).y },
      { ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 },
    );
    const footman = (id: string, col: number, row: number) => ({ ...game.units.find((unit) => unit.id === "w1")!, id, kind: "footman" as const, ...at(col, row), order: { type: "idle" as const }, radius: 18 });
    game.units.push(footman("f1", 5, 5), footman("f2", 6, 5), footman("f3", 5, 6));
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:transport");
    game.units.push({ ...game.units.find((unit) => unit.id === "w1")!, id: "ferry", kind: "transport", ...at(11, 3), order: { type: "idle" }, radius: 30 });
    const board = planNavalTactics(snapshotGame(game), "player", options).find((command) => command.type === "board");
    expect(board).toMatchObject({ type: "board", transportId: "ferry" });
    if (board?.type !== "board") throw new Error("no boarding");
    expect(board.unitIds.some(id => ["f1","f2","f3"].includes(id))).toBe(true);
    const reserved = game.units.map(unit => ({ ...unit }));
    const ferry = reserved.find(unit => unit.id === "ferry")!;
    for (const id of board.unitIds) expect(boardUnit(ferry, reserved.find(unit => unit.id === id)!, reserved)).toBe(true);
    expect(board.unitIds.filter(id=>id.startsWith("w"))).toHaveLength(1);
    // One stands on the island already: it goes for the hall, and is the naval script's to move.
    game.units.push(footman("landed", 21, 11));
    const landed = planNavalTactics(snapshotGame(game), "player", options).find((command) => command.type === "attackMove" && command.unitIds.includes("landed"));
    expect(landed).toMatchObject({ x: at(22, 9).x, y: at(22, 9).y });
    expect(navalUnitIds(snapshotGame(game), "player", options).has("landed")).toBe(true);
  });

  it("counts the passengers aboard a transport in its supply, as the sim does", () => {
    const game = islandGame();
    const worker = game.units.find((unit) => unit.id === "w1")!;
    game.units = game.units.filter((unit) => unit !== worker);
    game.units.push({ ...game.units[0]!, id: "ferry", kind: "transport", x: at(12, 4).x, y: at(12, 4).y, cargo: [worker] });
    expect(projectedSupplyUsed(snapshotGame(game), "player")).toBe(6 + 1);
  });

  it("raids the enemy's door across a lake: a shipyard on its own shore, then its warships shoot the enemy's worker", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = lakeGame();
    const want = navalWant(snapshotGame(game), "player", options)!;
    expect(want.id).toBe("naval:shipyard");
    const command = want.issue(new Set());
    if (command?.type !== "build") throw new Error("no build");
    expect(isShoreFootprint(game.map, command.x, command.y, 44)).toBe(true);
    expect(command.x).toBeLessThan(at(10, 0).x);
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: command.x, y: command.y, radius: 44 });
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:warship");
    game.units.push({ ...game.units.find((unit) => unit.id === "w1")!, id: "ship", kind: "warship", ...at(12, 9), order: { type: "idle" }, hp: 180, maxHp: 180, attackRange: 390 });
    expect(planNavalTactics(snapshotGame(game), "player", options)).toContainEqual({ type: "attackMove", unitIds: ["ship"], ...at(21, 10) });
  });

  it("raises no shipyard on water an enemy's warship sails, where the ship would sink the site, but under a tower of its own", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = lakeGame();
    game.units.push({ ...game.units.find((unit) => unit.id === "we")!, id: "gun", kind: "warship", ...at(18, 16), order: { type: "idle" }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390 });
    expect(navalWant(snapshotGame(game), "player", options)?.issue(new Set())).not.toMatchObject({ buildingKind: "shipyard" });
    // A tower of its own by the west shore covers it (see @@@coast-tower).
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "tower", kind: "defenseTower", ...at(5, 9), radius: 30, complete: true });
    expect(navalWant(snapshotGame(game), "player", options)?.issue(new Set())).toMatchObject({ type: "build", buildingKind: "shipyard" });
  });

  it("leaves a door its towers cover, and a pond, alone", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    expect(navalWant(snapshotGame(lakeGame(false, true)), "player", options)).toBeUndefined();
    expect(navalWant(snapshotGame(lakeGame(true)), "player", options)).toBeUndefined();
  });

  it("does nothing on a map whose land is one whole and that has no ship", () => {
    let cells = "";
    for (let index = 0; index < 600; index += 1) cells += ".";
    const game = islandGame({ cell: 32, cols: 30, rows: 20, cells });
    const snapshot = snapshotGame(game);
    expect(navalWant(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() })).toBeUndefined();
    expect(navalUnitIds(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() }).size).toBe(0);
  });
  it("ships workers away from a depleted island to a live owned mine", () => {
    const game = islandGame();
    game.scriptedVictory = true;
    for (const mine of game.resources) if (mine.id !== "island") mine.amount = 0;
    game.buildings.push({ ...game.buildings[0]!, id: "rich-hall", ...at(23, 11) });
    for (const worker of game.units) worker.order = { type: "idle" };
    const boat = game.spawnUnit("player", "transport", at(10, 9).x, at(10, 9).y);
    boat.id="ferry";
    const options = { version: "v8" as const, memory: createAiPolicyMemory(), teams: game.teams };
    let boarded = false;
    for (let tick = 0; tick < 1600; tick++) {
      if (tick % 30 === 0) for (const command of planNavalTactics(snapshotGame(game), "player", options)) {
        boarded ||= command.type === "board";
        issuePlayerCommand(game, "player", command);
      }
      stepGame(game);
    }
    expect(boarded).toBe(true);
    const richMine = game.resources.find(mine => mine.id === "island")!;
    expect(game.units.filter(unit => unit.kind === "worker" && sameGround(game.map, unit, richMine))).toHaveLength(6);
    expect(options.memory.naval?.ferries?.ferry?.purpose).not.toBe("settle");
  });

  it("keeps the hall budget while settlers sail, and a ferry budget before local gold runs out", () => {
    const game = islandGame();
    const memory = createAiPolicyMemory();
    memory.naval = { ferries: { ferry: { purpose: "settle", targetId: "island", from: at(9,9), to: at(20,9), phase: "sailing", crewIds: [], sinceTick: 0 } } };
    expect(navalBudgetReserve(snapshotGame(game), "player", { memory })).toBe(400);
    for (const mine of game.resources) if (mine.id !== "island") mine.amount = 0;
    expect(navalBudgetReserve(snapshotGame(game), "player", { memory })).toBe(560);
  });

  it('leaves deck repair engineers on their warships instead of dispatching empty miner ferries', () => {
    const game=islandGame();
    for(const mine of game.resources)if(mine.id!=='island')mine.amount=0;
    game.buildings.push({...game.buildings[0]!,id:'rich-hall',...at(23,11)});
    const worker=game.units[0]!;
    game.units=[worker];worker.order={type:'idle'};
    const warship=game.spawnUnit('player','warship',at(13,9).x,at(13,9).y);
    expect(boardUnit(warship,worker,game.units)).toBe(true);
    const boat=game.spawnUnit('player','transport',at(12,13).x,at(12,13).y);
    const options={version:'v8' as const,memory:createAiPolicyMemory()};
    planNavalTactics(snapshotGame(game),'player',options);
    expect(options.memory.naval?.ferries?.[boat.id]).toBeUndefined();
    expect(worker.deck?.shipId).toBe(warship.id);
  });

  it('does not relocate idle workers to a fully staffed mine', () => {
    const game=islandGame();
    for(const mine of game.resources)if(mine.id!=='island')mine.amount=0;
    game.buildings.push({...game.buildings[0]!,id:'rich-hall',...at(23,11)});
    for(const worker of game.units)worker.order={type:'idle'};
    for(let i=0;i<5;i++)game.units.push({...createUnit(`miner-${i}`,'player','worker',at(22,9).x,at(22,9).y),order:{type:'mine',resourceId:'island',phase:'toMine',timer:0}});
    const boat=game.spawnUnit('player','transport',at(12,13).x,at(12,13).y);
    const options={version:'v7' as const,memory:createAiPolicyMemory()};
    planNavalTactics(snapshotGame(game),'player',options);
    expect(options.memory.naval?.ferries?.[boat.id]).toBeUndefined();
  });

  it('launches an effective partial colony load before a stalled boarder triggers cancellation', () => {
    const game=islandGame();game.tick=seconds(21);
    const boat=game.spawnUnit('player','transport',at(10,9).x,at(10,9).y);
    const worker=game.units[0]!,waiting=game.units[1]!;
    expect(boardUnit(boat,worker,game.units)).toBe(true);
    waiting.order={type:'board',transportId:boat.id};
    const memory=createAiPolicyMemory();
    memory.naval={ferries:{[boat.id]:{purpose:'settle',targetId:'island',from:{x:boat.x,y:boat.y},to:at(19,9),phase:'loading',crewIds:[worker.id,waiting.id],sinceTick:0,
      progress:{tick:0,x:boat.x,y:boat.y,heading:boat.sailing!.heading,phase:'loading',crew:worker.id}}}};
    const commands=planNavalTactics(snapshotGame(game),'player',{version:'v5',memory});
    expect(commands).toContainEqual({type:'stop',unitIds:[waiting.id]});
    expect(commands).toContainEqual({type:'unload',unitIds:[boat.id],...at(19,9)});
    expect(memory.naval.ferries![boat.id]!.phase).toBe('sailing');
  });

  it('loads colony engineers before infantry can occupy their deck space',()=>{
    const game=islandGame(),boat=game.spawnUnit('player','transport',at(10,9).x,at(10,9).y);
    for(let i=0;i<6;i++)game.spawnUnit('player','footman',at(6,8+i).x,at(6,8+i).y);
    const options={version:'v7' as const,memory:createAiPolicyMemory()};
    const first=planNavalTactics(snapshotGame(game),'player',options).find(command=>command.type==='board'&&command.transportId===boat.id);
    expect(first?.type).toBe('board');
    if(first?.type!=='board')throw new Error('No engineers dispatched');
    expect(first.unitIds).toHaveLength(2);
    for(const id of first.unitIds){const worker=game.units.find(unit=>unit.id===id)!;expect(worker.kind).toBe('worker');expect(boardUnit(boat,worker,game.units)).toBe(true);}
    const second=planNavalTactics(snapshotGame(game),'player',options).find(command=>command.type==='board'&&command.transportId===boat.id);
    expect(second?.type).toBe('board');
    if(second?.type==='board')expect(second.unitIds.every(id=>game.units.find(unit=>unit.id===id)!.kind==='footman')).toBe(true);
  });

  it('releases an empty returning ferry where it is rather than sending it to an obsolete coast', () => {
    const game=islandGame(),boat=game.spawnUnit('player','transport',at(27,16).x,at(27,16).y);
    const memory=createAiPolicyMemory();
    memory.naval={ferries:{[boat.id]:{purpose:'rebase',targetId:'natural',from:at(9,9),to:at(19,9),phase:'return',crewIds:[],sinceTick:0}}};
    const commands=planNavalTactics(snapshotGame(game),'player',{version:'v7',memory});
    expect(memory.naval.ferries![boat.id]).toBeUndefined();
    expect(commands.some(command=>command.type==='move'&&command.unitIds.includes(boat.id))).toBe(false);
  });

});


describe("naval strategic choices", () => {
  it("develops an unclaimed reachable mainland mine before buying an overseas expedition", () => {
    const terrain=coast();
    terrain.cells=Array.from({length:terrain.rows},(_,row)=>Array.from({length:terrain.cols},(_,col)=>
      col<=10 ? '.' : col===11 ? ',' : terrain.cells[row*terrain.cols+col]).join('')).join('');
    const sim=islandGame(terrain);
    sim.buildings=sim.buildings.filter(b=>b.id!=="hall-b");
    sim.players.player!.supplyUsed=25;
    const want = navalWant(snapshotGame(sim),"player",{version:"v7",memory:createAiPolicyMemory()});
    expect(want?.issue(new Set())).toMatchObject({type:"build",buildingKind:"townHall"});
  });

  it("keeps a weak loaded landing force offshore until the mine guards are cleared", () => {
    const sim=islandGame();
    const mine=sim.resources.find(m=>m.id==="island")!;
    const boat=createUnit("ferry","player","transport",at(9,9).x,at(9,9).y);
    boat.cargo=[createUnit("builder","player","worker",0,0),createUnit("soldier","player","footman",0,0)];
    sim.units=[boat,createUnit("guard","neutral","redDragon",mine.x,mine.y)];
    const memory=createAiPolicyMemory();
    memory.naval={ferries:{ferry:{purpose:"settle",targetId:mine.id,from:at(9,9),to:at(19,9),phase:"loading",crewIds:[],sinceTick:0}}};
    const options={version:"v7" as const,memory};
    expect(planNavalTactics(snapshotGame(sim),"player",options).some(c=>c.type==="unload")).toBe(false);
    sim.units=sim.units.filter(u=>u.id!=="guard");
    expect(planNavalTactics(snapshotGame(sim),"player",options).some(c=>c.type==="unload")).toBe(true);
  });
});

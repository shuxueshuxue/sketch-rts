import { describe, expect, it } from "vitest";
import { createBuilding } from "../../shared/map";
import { combatCapability } from "../../shared/combat-capabilities";
import { hullFits } from "../../shared/ship-navigation";
import { installedWeapons, SHIP_WEAPONS } from "../../shared/ship-equipment";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../../shared/sim";
import { seconds } from "../../shared/time";
import { createAiPolicyMemory } from "../memory";
import { navalUnitIds, navalWant, planNavalTactics } from "./naval";
import { boardUnit, syncDecks } from '../../shared/decks';
import { fleetStations } from './fleet-formation';
import { navalServices } from './naval-services';
import type { NavalPlanMemory } from '../memory';

function coastFleet() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = [];
  game.map.width = game.map.height = 4000;
  game.map.terrain = { cell: 40, cols: 100, rows: 100, cells: (".".repeat(25) + "~".repeat(75)).repeat(100) };
  game.scriptedVictory = true;
  game.players.player!.gold = 5000;
  game.buildings.push(createBuilding("heavy-dock", "player", "shipyard", 1000, 1000, true));
  for (let index = 0; index < 6; index++) game.spawnUnit("player", "footman", 800, 600 + index * 40);
  return game;
}

describe("heavy broadside ships in shared naval policy", () => {
  it("buys and installs the remaining four guns at the dock without creating crew or extra mounts", () => {
    const game = coastFleet(), ship = game.spawnUnit("player", "shipOfTheLine", 1200, 1000);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    expect(installedWeapons(game, ship)).toHaveLength(4);
    expect(navalUnitIds(snapshotGame(game), "player", options).has(ship.id)).toBe(true);
    const gold = game.players.player!.gold;
    for (let tick = 0; tick < seconds(20) && installedWeapons(game, ship).length < 8; tick++) {
      const want = navalWant(snapshotGame(game), "player", options);
      if (want?.id === "naval:gun") {
        const command = want.issue(new Set());
        if (command) issuePlayerCommand(game, "player", command);
      }
      for (const command of planNavalTactics(snapshotGame(game), "player", options)) issuePlayerCommand(game, "player", command);
      stepGame(game);
      expect(hullFits(game.map, ship)).toBe(true);
    }
    const guns = installedWeapons(game, ship);
    expect(guns).toHaveLength(8);
    expect(new Set(guns.map(gun => gun.mountId)).size).toBe(8);
    expect(game.players.player!.gold).toBe(gold - 4 * SHIP_WEAPONS.shipCannon.cost);
    expect(game.units.some(unit => unit.kind === "worker")).toBe(false);
    expect(navalWant(snapshotGame(game), "player", options)?.id).not.toBe("naval:gun");
  });

  it("counts its real battery and assigns it to an engagement with a nearby enemy ship", () => {
    const game = coastFleet(), ship = game.spawnUnit("player", "shipOfTheLine", 1600, 1000);
    const enemy = game.spawnUnit("enemy", "warship", 1600, 1300);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const snapshot = snapshotGame(game);
    expect(combatCapability(snapshot, ship)).toEqual({ armed: true, range: 312, dps: 40 });
    expect(navalUnitIds(snapshot, "player", options).has(ship.id)).toBe(true);
    const commands = planNavalTactics(snapshot, "player", options);
    expect(commands).toContainEqual({ type: "attackMove", unitIds: [ship.id], x: enemy.x, y: enemy.y });
    for (const command of commands) issuePlayerCommand(game, "player", command);
    const hp = enemy.hp;
    for (let tick = 0; tick < seconds(8) && enemy.hp === hp; tick++) stepGame(game);
    expect(enemy.hp).toBeLessThan(hp);
  });

  it('follows a moving enemy through one engagement without issuing a new voyage every think', () => {
    const game = coastFleet(), ship = game.spawnUnit('player', 'shipOfTheLine', 1600, 1100);
    const enemy = game.spawnUnit('enemy', 'warship', 1600, 1460);
    issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [enemy.id], x: 1600, y: 3000, avoidCombat: true });
    const options = { version: 'v8' as const, memory: createAiPolicyMemory() };
    let issued = 0, pursuitTicks = 0, shots = 0;
    for (let tick = 0; tick < seconds(10); tick++) {
      if (tick % 10 === 0) for (const command of planNavalTactics(snapshotGame(game), 'player', options)) {
        if (command.type === 'attackMove' && command.unitIds.includes(ship.id)) issued++;
        issuePlayerCommand(game, 'player', command);
      }
      stepGame(game);
      pursuitTicks += Number(ship.sailing?.pursuit?.targetId === enemy.id);
      shots += Number(installedWeapons(game, ship).some(gun => gun.cooldownRemaining > 0));
    }
    expect(issued).toBe(1); expect(pursuitTicks).toBeGreaterThan(seconds(5));
    expect(shots).toBeGreaterThan(0);
    expect(options.memory.naval?.combat?.[ship.id]?.targetId).toBe(enemy.id);
  });

  it('keeps armed loaded carriers assigned to their ferry mission instead of issuing combat orders', () => {
    const game = coastFleet(), carrier = game.spawnUnit('player', 'carrier', 1700, 1200);
    const donor = game.spawnUnit('player', 'warship', 2600, 2500);
    game.items.push({ ...installedWeapons(game, donor)[0]!, id: 'carrier-gun', shipId: carrier.id, mountId: 'bow' });
    const crew = game.spawnUnit('player', 'footman', carrier.x, carrier.y);
    expect(boardUnit(carrier, crew, game.units)).toBe(true); syncDecks(game.units);
    const enemy = game.spawnUnit('enemy', 'warship', 1700, 1650);
    enemy.order = { type: 'hold', x: enemy.x, y: enemy.y };
    const memory = createAiPolicyMemory();
    memory.naval = { ferries: { [carrier.id]: { purpose: 'assault', targetId: 'landing', from: { x: 1200, y: 1000 }, to: { x: 3000, y: 3000 }, phase: 'sailing', crewIds: [crew.id], sinceTick: game.tick } } };
    expect(combatCapability(game, carrier).armed).toBe(true);
    const commands = planNavalTactics(snapshotGame(game), 'player', { version: 'v8', memory });
    expect(commands.some(command => command.type === 'attackMove' && command.unitIds.includes(carrier.id))).toBe(false);
    expect(memory.naval.ferries?.[carrier.id]?.phase).toBe('sailing');
  });

  it('leaves sheltered melee crew out of capture service tasks', () => {
    const game = coastFleet(), ship = game.spawnUnit('player', 'shipOfTheLine', 1600, 1200);
    const crew = game.spawnUnit('player', 'footman', ship.x, ship.y);
    expect(boardUnit(ship, crew, game.units)).toBe(true); syncDecks(game.units);
    crew.cabin = { shipId: ship.id };
    const prize = game.spawnUnit('enemy', 'transport', 1950, 1200); prize.hp = 40;
    const service = navalServices(snapshotGame(game), 'player', { version: 'v8', memory: createAiPolicyMemory() });
    expect(service.commands.some(command => command.type === 'board' && command.unitIds.includes(crew.id))).toBe(false);
    expect(service.reserved.has(crew.id)).toBe(false);
  });

  it('puts the flagship at the center with stable formation slots across snapshot list changes', () => {
    const game = coastFleet(), flagship = game.spawnUnit('player', 'shipOfTheLine', 1700, 1300);
    const fleet = [flagship, game.spawnUnit('player', 'warship', 2000, 1400), game.spawnUnit('player', 'warship', 2300, 1200)];
    const memory: NavalPlanMemory = {}, goal = { x: 3000, y: 3000 };
    const first = fleetStations(snapshotGame(game), fleet, goal, memory);
    expect(memory.muster?.leader).toBe(flagship.id);
    const anchor = memory.muster?.launched ? goal : memory.muster!.at;
    expect(first.get(flagship.id)).toMatchObject(anchor);
    const heading = memory.muster?.heading;
    flagship.x += 40; flagship.y += 60;
    const second = fleetStations(snapshotGame(game), [...fleet].reverse(), goal, memory);
    expect(second).toEqual(first); expect(memory.muster?.heading).toBe(heading);
  });
});

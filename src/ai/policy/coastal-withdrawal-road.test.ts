import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { setBuildingBodies } from '../../shared/terrain';
import { createBuilding } from '../../shared/map';
import { coastalRefuge, coastalWithdrawalPassage, coastalWithdrawalPrefixSafe, outmatchingCoast } from './coastal-risk';
import { planNavalTactics } from './naval';
import * as coastalRisk from './coastal-risk';

const saved = JSON.parse(gunzipSync(readFileSync(new URL('./test-fixtures/coastal-withdrawal-237600.json.gz', import.meta.url))).toString());
const clinical = JSON.parse(gunzipSync(readFileSync(new URL('./test-fixtures/coastal-withdrawal-clinical-prefixes.json.gz', import.meta.url))).toString());
function actual() {
  const frame = structuredClone(saved), snapshot = frame.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const ship = snapshot.units.find((unit: any) => unit.id === 'unit-p0-warship-34722');
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', { memory: frame.memories.p0, teams: snapshot.teams });
  return { frame, snapshot, ship, options };
}

describe('actual installed withdrawal roads', () => {
  it('rejects the real inward road even though its saved destination is still safe', () => {
    const { frame, snapshot, ship, options } = actual(), before = JSON.stringify(frame);
    const withdrawal = options.memory.naval!.coastalRetreat![ship.id]!;
    expect(outmatchingCoast(snapshot, 'p0', ship, withdrawal, options)).toEqual([]);
    expect(coastalWithdrawalPrefixSafe(snapshot, ship, ship.sailing.route, options)).toBe(false);
    expect(JSON.stringify(frame)).toBe(before);
  });

  it('continues the original ordered endpoint search after its first complete road turns into fire', () => {
    const { snapshot, ship, options } = actual();
    const threats = outmatchingCoast(snapshot, 'p0', ship, ship, options);
    const original = coastalRefuge(snapshot, ship, threats)!;
    expect(coastalRefuge(snapshot, ship, threats, () => true)).toEqual(original);
    expect(coastalWithdrawalPassage(snapshot, ship, original, options)).toBeUndefined();
    const admitted = coastalRefuge(snapshot, ship, threats, goal => !!coastalWithdrawalPassage(snapshot, ship, goal, options))!;
    expect(admitted).not.toEqual(original);
    const route = coastalWithdrawalPassage(snapshot, ship, admitted, options)!;
    expect(route.partial).toBe(false);
    expect(Math.hypot(route.points.at(-1)!.x - admitted.x, route.points.at(-1)!.y - admitted.y)).toBeLessThanOrEqual(5);
  });

  it('queries only the public coordinates even when a refuge supplies a pose heading', () => {
    const { snapshot, ship, options } = actual();
    const threats = outmatchingCoast(snapshot, 'p0', ship, ship, options);
    const pose = coastalRefuge(snapshot, ship, threats,
      goal => !!coastalWithdrawalPassage(snapshot, ship, { x: goal.x, y: goal.y }, options))!;
    const ordinary = coastalWithdrawalPassage(snapshot, ship, { x: pose.x, y: pose.y }, options)!;
    expect(ordinary).toBeDefined();
    expect(coastalWithdrawalPassage(snapshot, ship, pose, options)).toEqual(ordinary);
    // Explicit goal metadata counterfactual: the issued move still has only x/y.
    const withHeading = { x: pose.x, y: pose.y, heading: ordinary.points.at(-1)!.heading + Math.PI / 2 };
    expect(coastalWithdrawalPassage(snapshot, ship, withHeading, options)).toEqual(ordinary);
  });

  it('preserves every actual later native escape prefix, including covered curved departures', () => {
    expect(clinical.rows).toHaveLength(29);
    expect(clinical.rows[0].frame.snapshot.tick).toBe(232755);
    expect(clinical.rows.at(-1).frame.snapshot.tick).toBe(233175);
    const rejected = [];
    for (const { frame: recorded } of clinical.rows) {
      const frame = structuredClone(recorded), snapshot = frame.snapshot, before = JSON.stringify(frame);
      setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
      const ship = snapshot.units.find((unit: any) => unit.id === 'unit-p0-bombardShip-50739');
      const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', { memory: frame.memories.p0, teams: snapshot.teams });
      if (!coastalWithdrawalPrefixSafe(snapshot, ship, ship.sailing.route, options)) rejected.push(snapshot.tick);
      expect(JSON.stringify(frame)).toBe(before);
    }
    expect(rejected).toEqual([]);
  });

  it('releases the actual unsafe order through the same naval owner and chooses another escape', () => {
    const { snapshot, ship, options } = actual();
    const old = structuredClone(options.memory.naval!.coastalRetreat![ship.id]!);
    const commands = planNavalTactics(snapshot, 'p0', options);
    expect(commands).toContainEqual({ type: 'stop', unitIds: [ship.id] });
    const escape = commands.find(command => command.type === 'move' && command.unitIds.includes(ship.id));
    expect(escape).toBeDefined();
    expect(escape).not.toMatchObject({ x: old.x, y: old.y });
    expect(options.memory.naval!.coastalRetreat![ship.id]).toBeDefined();
  });

  it('does not turn a clone without real building solids into an admitted ordinary road', () => {
    const { snapshot, ship, options } = actual();
    const threats = outmatchingCoast(snapshot, 'p0', ship, ship, options);
    const goal = coastalRefuge(snapshot, ship, threats, point => !!coastalWithdrawalPassage(snapshot, ship, point, options))!;
    expect(goal).toBeDefined();
    // Explicit counterfactual body placement, not another real-game outcome.
    snapshot.buildings.push(createBuilding('counterfactual-solid-at-refuge', 'p0', 'townHall', goal.x, goal.y, true));
    setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
    expect(coastalWithdrawalPassage(snapshot, ship, goal, options)).toBeUndefined();
  });

  it('publishes the newly admitted move in the same think even if its coordinates match the released order', () => {
    const { snapshot, ship, options } = actual();
    const threats = outmatchingCoast(snapshot,'p0',ship,ship,options);
    const goal = coastalRefuge(snapshot,ship,threats,point=>!!coastalWithdrawalPassage(snapshot,ship,point,options))!;
    // Explicit counterfactual command/intent only. Keep the original observed
    // unsafe installed road; this is an ownership boundary contract, not a
    // claimed native trajectory or a weakened opponent.
    ship.order = {type:'move',x:goal.x,y:goal.y,avoidCombat:true};
    options.memory.naval!.coastalRetreat![ship.id] = {x:goal.x,y:goal.y};
    expect(coastalWithdrawalPrefixSafe(snapshot,ship,ship.sailing.route,options)).toBe(false);
    // Isolate the ordinary-refuge branch. The independently queried ordinary
    // road and all real threats/solids stay unchanged; this does not claim
    // the original fixture lacked its valid short astern alternative.
    const astern = vi.spyOn(coastalRisk,'coastalAsternStep').mockReturnValue(undefined);
    let commands;
    try { commands = planNavalTactics(snapshot,'p0',options).filter(command=>'unitIds'in command&&command.unitIds.includes(ship.id)); }
    finally { astern.mockRestore(); }
    expect(commands[0]).toEqual({type:'stop',unitIds:[ship.id]});
    expect(commands).toContainEqual({type:'move',unitIds:[ship.id],x:goal.x,y:goal.y,avoidCombat:true});
  });
});

function arc(danger: { x: number; y: number }) {
  const { snapshot, ship, options } = actual();
  ship.x = 1000; ship.y = 1000; ship.sailing.heading = Math.PI / 2;
  const enemy = snapshot.units.find((unit: any) => unit.id === 'unit-p1-archer-9414');
  enemy.x = danger.x; enemy.y = danger.y;
  snapshot.units = [ship, enemy]; snapshot.buildings = [];
  return { snapshot, ship, options, end: { x: 900, y: 1100, heading: Math.PI, curvature: .01 } };
}

describe('native circular centre motion inside existing fire coverage', () => {
  it.each([
    { name: 'left curve', danger: { x: 1200, y: 1100 }, heading: Math.PI / 2,
      end: { x: 900, y: 1100, heading: Math.PI, curvature: .01 } },
    { name: 'right curve', danger: { x: 800, y: 1100 }, heading: Math.PI / 2,
      end: { x: 1100, y: 1100, heading: 0, curvature: -.01 } },
    { name: 'contact pivot', danger: { x: 1200, y: 1100 }, heading: 0,
      end: { x: 900, y: 1100, heading: Math.PI / 2, pivot: { x: 900, y: 1000 } } },
  ])('rejects an inward $name whose endpoint chord initially points away', ({ danger, heading, end }) => {
    const { snapshot, ship, options } = arc(danger);
    ship.sailing.heading = heading;
    const chord = { x: end.x, y: end.y, heading: end.heading };
    expect(coastalWithdrawalPrefixSafe(snapshot, ship, { points: [chord] }, options)).toBe(true);
    expect(coastalWithdrawalPrefixSafe(snapshot, ship, { points: [end] }, options)).toBe(false);
  });
  it('preserves an outward arc and a finite outward partial leg without calling either arrival', () => {
    const { snapshot, ship, options, end } = arc({ x: 1200, y: 900 });
    expect(coastalWithdrawalPrefixSafe(snapshot, ship, { points: [end] }, options)).toBe(true);
    expect(coastalWithdrawalPrefixSafe(snapshot, ship, { points: [{ x: 990, y: 1010, heading: Math.PI / 2 }] }, options)).toBe(true);
    expect(coastalWithdrawalPrefixSafe(snapshot, ship, { points: [] }, options)).toBe(false);
    expect(coastalWithdrawalPrefixSafe(snapshot, ship, undefined, options)).toBe(false);
  });
});

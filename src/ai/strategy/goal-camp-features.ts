import { ABILITY_DEFS, unitRules } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { equipmentProtection } from '../../shared/equipment';
import { isWalkableChar } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, Unit } from '../../shared/types';
import { unitValue } from '../../shared/unit-value';
import { combatRating, strengthOf } from '../policy/v6/strength';
import { creepForce, forceFor, type Camp } from '../policy/v7/creep';

export type CampModelMember = Readonly<{
  body: Unit; nativeCombatRating: number; nativeEquipmentProtection: number;
  nativeReplacementGold: number; nativeCapability: Readonly<{ dps: number; range: number }>;
  healer: boolean; caster: boolean; worker: boolean; ranged: boolean;
}>;
export type CampConsumableDecision = 'none' | 'healingScroll' | 'guardianScroll';
export function campCompositionSignature(allies: readonly CampModelMember[], enemies: readonly CampModelMember[],
  consumable: CampConsumableDecision): string {
  return JSON.stringify({ own: [...new Set(allies.map(m => m.body.kind))].sort(),
    camp: enemies.map(m => m.body.kind).sort(), consumable, workers: allies.filter(m => m.worker).length });
}
export const CAMP_FEATURE_NAMES = [
  'logCampForceRatio', 'logCombatRatingRatio', 'logDpsRatio', 'logHpRatio',
  'ownHpFraction', 'campHpFraction', 'minimumOwnHpFraction', 'minimumCampHpFraction',
  'ownRangedShare', 'campRangedShare', 'ownHealerShare', 'campCasterShare',
  'ownCount', 'campCount', 'workerCount', 'meanOwnLevel', 'meanCampLevel',
  'meanOwnProtection', 'meanCampProtection', 'logSpeedRatio', 'logRangeRatio',
  'campWalkableFraction', 'stagingWalkableFraction', 'useHealingScroll', 'useGuardianScroll',
  'capitalGold',
] as const;
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const average = (values: readonly number[]) => sum(values) / Math.max(1, values.length);
const logRatio = (a: number, b: number) => Math.log((a + 1e-6) / (b + 1e-6));

/** Numeric features shared by fitting and live quoting. There is no map ID,
 * catalog-full-health replacement, fitted alpha or route request here. */
export function campFeatureVector(input: Readonly<{
  allies: readonly CampModelMember[]; enemies: readonly CampModelMember[];
  campWalkableFraction: number; stagingWalkableFraction: number; consumable: CampConsumableDecision;
}>): number[] {
  const { allies, enemies } = input, own = allies.map(m => m.body), guards = enemies.map(m => m.body);
  const camp: Camp = { center: { x: average(guards.map(u => u.x)), y: average(guards.map(u => u.y)) },
    creeps: guards, strength: strengthOf(guards), reach: 0 };
  const fractions = (units: readonly Unit[]) => units.map(u => u.hp / u.maxHp);
  const values = [
    logRatio(creepForce(own, camp), forceFor(camp)),
    logRatio(sum(allies.map(m => m.nativeCombatRating)), sum(enemies.map(m => m.nativeCombatRating))),
    logRatio(sum(allies.map(m => m.nativeCapability.dps)), sum(enemies.map(m => m.nativeCapability.dps))),
    logRatio(sum(own.map(u => u.hp)), sum(guards.map(u => u.hp))),
    sum(own.map(u => u.hp)) / Math.max(1, sum(own.map(u => u.maxHp))),
    sum(guards.map(u => u.hp)) / Math.max(1, sum(guards.map(u => u.maxHp))),
    Math.min(1, ...fractions(own)), Math.min(1, ...fractions(guards)),
    average(allies.map(m => Number(m.ranged))), average(enemies.map(m => Number(m.ranged))),
    average(allies.map(m => Number(m.healer))), average(enemies.map(m => Number(m.caster))),
    own.length, guards.length, allies.filter(m => m.worker).length,
    average(own.map(u => u.level ?? 0)), average(guards.map(u => u.level ?? 0)),
    average(allies.map(m => m.nativeEquipmentProtection)), average(enemies.map(m => m.nativeEquipmentProtection)),
    logRatio(average(own.map(u => u.speed)), average(guards.map(u => u.speed))),
    logRatio(average(allies.map(m => m.nativeCapability.range)), average(enemies.map(m => m.nativeCapability.range))),
    input.campWalkableFraction, input.stagingWalkableFraction,
    Number(input.consumable === 'healingScroll'), Number(input.consumable === 'guardianScroll'),
    sum(allies.map(m => m.nativeReplacementGold)),
  ];
  if (!own.length || !guards.length || values.some(value => !Number.isFinite(value))) throw Error('camp-feature-input-invalid');
  return values;
}

export function campModelMember(snapshot: GameSnapshot, body: Unit): CampModelMember {
  const rules = unitRules(snapshot, body), abilities = (rules.abilities ?? []).map(kind => ABILITY_DEFS[kind]);
  return { body, nativeCombatRating: combatRating(body), nativeEquipmentProtection: equipmentProtection(snapshot, body),
    nativeReplacementGold: unitValue(rules), nativeCapability: combatCapability(snapshot, body),
    healer: abilities.some(a => a.behavior === 'heal' || a.effectType === 'heal'), caster: abilities.length > 0,
    worker: body.kind === 'worker', ranged: body.attackClass === 'ranged' };
}

/** Fixed raw 7x7 terrain summary; no guessed choke class or pathfinding. */
export function campWalkableFraction(snapshot: GameSnapshot, point: Readonly<{ x: number; y: number }>): number {
  const terrain = snapshot.map.terrain; if (!terrain) return 1;
  const cx = Math.floor(point.x / terrain.cell), cy = Math.floor(point.y / terrain.cell);
  let count = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < terrain.cols && y < terrain.rows
      && isWalkableChar(terrain.cells[y * terrain.cols + x]!)) count++;
  }
  return count / 49;
}

export const CAMP_ENCOUNTER_FEATURE_NAMES = [...CAMP_FEATURE_NAMES,
  'logGeometricArrivalSpreadTicks', 'firstWaveRatingShare15Ticks', 'firstWaveRatingShare30Ticks',
  'approachBlockedFraction', 'minimumApproachCrossSection', 'rearCampBlockedFraction',
] as const;

/** Fixed, pre-contact descriptors, not an arrival fact or a route. Every
 * sample reads a bounded number of raw terrain cells. Realised damage/contact
 * times are reserved for validation and never enter this feature vector. */
export function campEncounterFeatureVector(snapshot: GameSnapshot, input: Parameters<typeof campFeatureVector>[0]): number[] {
  const { allies, enemies } = input;
  const center = { x: average(enemies.map(m => m.body.x)), y: average(enemies.map(m => m.body.y)) };
  const origin = { x: average(allies.map(m => m.body.x)), y: average(allies.map(m => m.body.y)) };
  const dx = center.x - origin.x, dy = center.y - origin.y, length = Math.hypot(dx, dy);
  const ux = length ? dx / length : 1, uy = length ? dy / length : 0;
  const arrivals = allies.map(member => {
    const unit = member.body;
    const gap = Math.min(...enemies.map(enemy => Math.max(0,
      Math.hypot(unit.x - enemy.body.x, unit.y - enemy.body.y)
      - unit.radius - enemy.body.radius - member.nativeCapability.range)));
    return gap / Math.max(1, unit.speed) * SIM_TICKS_PER_SECOND;
  });
  const first = Math.min(...arrivals), spread = Math.max(...arrivals) - first;
  const ratings = allies.map(m => m.nativeCombatRating), totalRating = sum(ratings);
  const weights = totalRating > 0 ? ratings : allies.map(m => m.body.hp);
  const total = sum(weights);
  const share = (ticks: number) => sum(weights.filter((_, i) => arrivals[i]! <= first + ticks)) / Math.max(1e-9, total);
  const terrain = snapshot.map.terrain, cell = terrain?.cell ?? 32;
  const open = (x: number, y: number) => {
    if (!terrain) return 1;
    const col = Math.floor(x / cell), row = Math.floor(y / cell);
    return Number(col >= 0 && row >= 0 && col < terrain.cols && row < terrain.rows
      && isWalkableChar(terrain.cells[row * terrain.cols + col]!));
  };
  let approachOpen = 0, minimumWidth = 1;
  for (let step = 0; step <= 16; step++) {
    const x = origin.x + dx * step / 16, y = origin.y + dy * step / 16;
    let width = 0;
    for (let lateral = -4; lateral <= 4; lateral++) width += open(x - uy * lateral * cell, y + ux * lateral * cell);
    minimumWidth = Math.min(minimumWidth, width / 9);
    for (let lateral = -1; lateral <= 1; lateral++) approachOpen += open(x - uy * lateral * cell, y + ux * lateral * cell);
  }
  let rearOpen = 0;
  for (let ring = 2; ring <= 8; ring += 2) for (let angle = -2; angle <= 2; angle++) {
    const turn = angle * Math.PI / 8, c = Math.cos(turn), s = Math.sin(turn);
    rearOpen += open(center.x + (ux * c - uy * s) * ring * cell,
      center.y + (uy * c + ux * s) * ring * cell);
  }
  return [...campFeatureVector(input), Math.log1p(spread), share(15), share(30),
    1 - approachOpen / 51, minimumWidth, 1 - rearOpen / 20];
}

import type { Unit } from "../../shared/types";
import type { Story, StoryVars } from "../../story/campaign";
import { oneOf } from "../../story/events";
import { ensure, never, scope, spawn, type Operation } from "../../story/kernel";
import { each, wait } from "../../story/ops";
import { empower, type Power } from "../../story/powers";
import { distance, ring, type Point } from "../../story/region";
import type { Text, Tone } from "../../story/stage";
import { seconds, type Duration } from "../../story/time";
import { CAST, GEAR, type CastKey } from "./cast";
import * as powers from "./powers";

export const PLAYER = "wardens";
export const FOLK = "fenfolk";
export const EMBER = "ember";
export const WILD = "wild";

export type IgFate = "joined" | "trial" | "executed";

export type Vars = StoryVars & {
  choices: Record<string, string>;
  villagersSaved: number;
  villagersLost: number;
  igFate?: IgFate;
  asheSaved: boolean;
  refugeesThrough: number;
  duFell: boolean;
  beaconLit?: boolean;
  vashkaSpared?: boolean;
};

export type AshenStory = Story<Vars>;

export type HeroKey = "lynn" | "du" | "tess" | "ig";
export const HERO_IDS: Record<HeroKey, string> = { lynn: "hero-lynn", du: "hero-du", tess: "hero-tess", ig: "hero-ig" };

// Each hero's powers and the level that brings each one.
const HERO_POWERS: Record<HeroKey, readonly { level: number; power: (level: () => number) => Power<any> }[]> = {
  lynn: [
    { level: 1, power: powers.piercingShot },
    { level: 3, power: powers.volley },
    { level: 6, power: powers.wardensRally },
  ],
  du: [
    { level: 1, power: () => powers.shieldWall() },
    { level: 2, power: powers.stomp },
    { level: 4, power: () => powers.taunt() },
  ],
  tess: [
    { level: 1, power: () => powers.thornSnare() },
    { level: 3, power: powers.mendingRain },
  ],
  ig: [
    { level: 1, power: powers.fireFlask },
    { level: 3, power: powers.shadowstep },
  ],
};

export function heroKeyOf(variant: string | undefined): HeroKey | undefined {
  return (Object.keys(HERO_IDS) as HeroKey[]).find((key) => CAST[key].id === variant);
}

// Brings a hero onto the field for this chapter (or moves the one already there), and gives it its powers for as long
// as the chapter runs.
export function* bringHero(story: AshenStory, key: HeroKey, at?: Point): Operation<Unit> {
  const member = CAST[key];
  const id = HERO_IDS[key];
  let unit = story.world.unit(id);
  if (!unit) unit = story.world.spawn(member, PLAYER, at ?? { x: 0, y: 0 }, { id });
  else if (at) story.world.place(unit, at);
  if (unit.owner !== PLAYER) unit.owner = PLAYER;
  story.stage.cast(unit, { name: member.name, color: member.color });
  yield* arm(story, key, unit);
  return unit;
}

function* arm(story: AshenStory, key: HeroKey, unit: Unit): Operation<void> {
  const member = CAST[key];
  const level = () => story.party.levelOf(member.id);
  story.vars.heroes[member.id] ??= { level: 1, gear: [] };
  const known = HERO_POWERS[key].filter((entry) => entry.level <= level()).map((entry) => entry.power(level));
  // A hero joining again (after a scene of its own, or a fall) sheds the powers it had before.
  story.party.hero(member.id)?.powers?.stop();
  const handle = yield* empower(story.world, unit, known, { willing: () => !story.stage.cinematicOn });
  story.party.join(member, unit.id, handle);
}

// A level gained: the flourish, and any power it brings.
export function onLevel(story: AshenStory, unitId: string, level: number) {
  const unit = story.world.unit(unitId);
  if (!unit) return;
  story.stage.float({ zh: `升级！ Lv ${level}`, en: `Level ${level}!` }, unit, { color: "#7a4fb0", size: 20, span: seconds(2.4) });
  story.world.effect("experienceBurst", unit, seconds(1.6));
  const key = heroKeyOf(unit.variant);
  if (!key) return;
  const hero = story.party.hero(CAST[key].id);
  for (const entry of HERO_POWERS[key]) {
    if (entry.level !== level || !hero?.powers) continue;
    const power = entry.power(() => story.party.levelOf(CAST[key].id));
    hero.powers.teach(power);
    story.stage.notice({ zh: `${text(CAST[key].name)} 习得：${text(power.name)}`, en: `${CAST[key].name.en} learned ${typeof power.name === "string" ? power.name : power.name.en}` }, "gain");
  }
}

// A fallen hero is carried off the field and comes back a while later beside the others (as a Warcraft hero rises at
// its altar), keeping what it had earned. Runs for as long as the chapter does.
export function* heroCare(story: AshenStory, options: { downtime?: Duration; rally?: () => Point | undefined; keepDown?: (key: HeroKey) => boolean } = {}): Operation<void> {
  yield* each("died", { unit: { id: oneOf(...Object.values(HERO_IDS)) } }, function* fallen(event) {
    const key = (Object.keys(HERO_IDS) as HeroKey[]).find((candidate) => HERO_IDS[candidate] === event.unit.id)!;
    // Only a hero of the party comes back (not one the story has fighting on its own side for now).
    if (event.unit.owner !== PLAYER || options.keepDown?.(key)) return;
    const xp = event.unit.xp;
    const name = CAST[key].name;
    story.stage.notice({ zh: `${text(name)}倒下了——稍后归队`, en: `${name.en} is down, back soon` }, "warn");
    yield* spawn(function* comeBack() {
      yield* wait(options.downtime ?? seconds(25));
      if (story.world.unit(HERO_IDS[key])) return;
      // Back beside the others: another hero, else the heart of the army, else where it fell.
      const others = Object.values(HERO_IDS).map((id) => story.world.unit(id)).filter((unit): unit is Unit => unit !== undefined);
      const troops = army(story);
      const at = others[0] ?? (troops.length > 0 ? densest(troops, 600) : undefined) ?? options.rally?.() ?? { x: event.unit.x, y: event.unit.y };
      const unit = story.world.spawn(CAST[key], PLAYER, ring(at, 60, 1, 3), { id: HERO_IDS[key], hpShare: 0.6 });
      unit.xp = xp;
      story.world.effect("summon", unit, seconds(1.2));
      story.stage.cast(unit, { name: CAST[key].name, color: CAST[key].color });
      yield* arm(story, key, unit);
      story.stage.bark(unit, backLines[key]);
      // The hero's powers live in this task: it stays for as long as the chapter does.
      yield* never();
    }, `comeBack:${key}`);
  }, "heroCare");
}

const backLines: Record<HeroKey, string> = {
  lynn: "还没完呢。",
  du: "老骨头，还能再拆两根。",
  tess: "我回来了——谁又把自己弄伤了？",
  ig: "烬族人，命硬。",
};

export function text(value: Text): string {
  return typeof value === "string" ? value : value.zh;
}

export function heroes(story: AshenStory): Unit[] {
  return Object.values(HERO_IDS).map((id) => story.world.unit(id)).filter((unit): unit is Unit => unit !== undefined);
}

export function hero(story: AshenStory, key: HeroKey): Unit | undefined {
  return story.world.unit(HERO_IDS[key]);
}

// A line from a hero if the hero is here; a line from nobody is skipped.
export function* say(story: AshenStory, who: HeroKey | Unit | undefined, words: string, options: { tone?: Tone; span?: Duration } = {}): Operation<void> {
  const unit = typeof who === "string" ? hero(story, who) : who;
  if (!unit) return;
  yield* story.stage.say(unit, words, options);
}

// A scene the player watches: letterbox down, the player's side standing still (it is told to stop and the pilot
// waits). It runs in a scope of its own, so the letterbox, the framing and whatever else the scene set up end with it.
export function* cutscene<T>(story: AshenStory, body: () => Operation<T>): Operation<T> {
  return yield* scope(function* scene() {
    yield* story.stage.cinematic();
    for (const unit of story.world.units({ owner: PLAYER })) {
      if (unit.kind === "worker") continue;
      unit.order = { type: "idle" };
      unit.orderQueue = [];
    }
    return yield* body();
  }, "cutscene");
}

// Walks the heroes (and anyone else given) to a place and waits until they arrive.
export function* gather(story: AshenStory, units: readonly Unit[], at: Point, limit: Duration = seconds(40)): Operation<void> {
  yield* story.world.walk(units, at, { limit });
}

export function* beat(span: number): Operation<void> {
  yield* wait(seconds(span));
}

// The player's army: everyone of the wardens that fights.
export function army(story: AshenStory): Unit[] {
  return story.world.units({ owner: PLAYER }).filter((unit) => unit.kind !== "worker");
}

// The unit with the most of the others within `radius`: where the army really is.
export function densest<T extends Point>(units: readonly T[], radius: number): T | undefined {
  let best: T | undefined;
  let bestCount = -1;
  for (const unit of units) {
    const count = units.filter((other) => distance(other, unit) <= radius).length;
    if (count > bestCount) {
      best = unit;
      bestCount = count;
    }
  }
  return best;
}

export function nearest<T extends Point>(from: Point, items: readonly T[]): T | undefined {
  return [...items].sort((a, b) => distance(from, a) - distance(from, b))[0];
}

// The gear a hero takes up, with its notice.
export function award(story: AshenStory, key: HeroKey, gear: keyof typeof GEAR) {
  story.party.equip(CAST[key].id, gear);
  const item = GEAR[gear];
  story.stage.notice({ zh: `获得装备：${item.name.zh}（${text(CAST[key].name)}）`, en: `New gear: ${item.name.en} (${CAST[key].name.en})` }, "gain");
  const unit = hero(story, key);
  if (unit) story.stage.float({ zh: item.name.zh, en: item.name.en }, unit, { color: "#9a6a12", size: 17, span: seconds(2.6) });
}

// Experience for a finished task, for every hero on the field.
export function reward(story: AshenStory, xp: number) {
  for (const unit of heroes(story)) {
    story.world.grantXp(unit, xp);
    story.stage.float({ zh: `+${xp} 经验`, en: `+${xp} xp` }, unit, { color: "#6a4a9a", size: 14 });
  }
}

// Removes the scene's leftovers: every unit of these owners (the fallen enemy's stragglers, the extras).
export function sweep(story: AshenStory, owners: readonly string[]) {
  for (const unit of story.world.units({ owner: owners })) story.world.remove(unit);
}

// Runs `body` with a mark on the map for as long as it runs.
export function* marked<T>(story: AshenStory, kind: "quest" | "rally" | "relic" | "target", at: Point | Unit, body: () => Operation<T>, label?: Text): Operation<T> {
  return yield* scope(function* withMark() {
    const mark = story.stage.mark(kind, at, { radius: kind === "rally" ? 120 : 70, ...(label !== undefined ? { label } : {}) });
    yield* ensure(mark.remove);
    return yield* body();
  }, "marked");
}

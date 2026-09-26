import type { Unit } from "../../../shared/types";
import type { Chapter } from "../../../story/campaign";
import { ensure, spawn, type Operation } from "../../../story/kernel";
import { every, until, wait } from "../../../story/ops";
import { empower } from "../../../story/powers";
import { ring, type Point } from "../../../story/region";
import { seconds } from "../../../story/time";
import { CAST } from "../cast";
import { army, beat, bringHero, cutscene, EMBER, FOLK, HERO_IDS, heroCare, PLAYER, reward, say, sweep, type Vars } from "../common";
import { PLACES, REGIONS } from "../places";
import { eruption, fireRain } from "../powers";

// 第四章 · 杜伯的誓言 - Three days on, the refugees of Reedholm and of the ash wood reach the ridge pass a march ahead of
// Vashka's host. The pass is narrow: a few can hold it while the rest file through. Du offers to be the few. Whether the
// others stand with him is the player's choice, and it decides whether Du walks out of the pass. Then Vashka comes to the
// ridge, and the two men who met in a burning village twenty years ago meet again.

const WAVES: { at: number; raiders: number; hounds: number; guards: number; pyres: number }[] = [
  { at: 4, raiders: 4, hounds: 3, guards: 0, pyres: 0 },
  { at: 38, raiders: 4, hounds: 2, guards: 1, pyres: 1 },
  { at: 75, raiders: 5, hounds: 3, guards: 2, pyres: 1 },
  { at: 115, raiders: 4, hounds: 4, guards: 2, pyres: 2 },
  { at: 150, raiders: 6, hounds: 2, guards: 3, pyres: 1 },
];
const HOLD_SECONDS = 180;
// Where Tess plants her thorns, from the mouth of the pass.
const THORNS = [
  { x: -110, y: 300 },
  { x: 0, y: 330 },
  { x: 110, y: 300 },
];
const EMBER_GATE: Point = { x: 6050, y: 5350 };

export const pass: Chapter<Vars> = {
  id: "pass",
  title: { zh: "第四章 · 杜伯的誓言", en: "Chapter Four · Du's Oath" },
  *play(story) {
    const { world, stage } = story;
    stage.clearProps(["tent", "banner", "deadTree", "ashPile", "crate", "tree", "campfire"]);
    for (const spot of [[4850, 3600], [5550, 3500], [4900, 4900], [5500, 5000], [4700, 5200], [5800, 4800]]) stage.prop("deadTree", { x: spot[0]!, y: spot[1]! }, { scale: 1.2 });
    stage.prop("cairn", { x: PLACES.passMouth.x - 150, y: PLACES.passMouth.y + 40 });
    const bridge = stage.prop("bridge", { x: PLACES.passMouth.x, y: PLACES.passMouth.y - 420 }, { scale: 1.4 });

    const mouth = PLACES.passMouth;
    const lynn = yield* bringHero(story, "lynn", { x: mouth.x + 40, y: mouth.y + 60 });
    const du = yield* bringHero(story, "du", { x: mouth.x - 20, y: mouth.y + 120 });
    const tess = yield* bringHero(story, "tess", { x: mouth.x - 60, y: mouth.y + 40 });
    const ig = story.vars.igFate === "joined" ? yield* bringHero(story, "ig", { x: mouth.x + 90, y: mouth.y + 110 }) : undefined;
    const soldiers = army(story).filter((unit) => !Object.values(HERO_IDS).includes(unit.id));
    soldiers.forEach((unit, index) => world.place(unit, ring({ x: mouth.x, y: mouth.y + 180 }, 150, index, soldiers.length)));
    // Standing with Du, a fallen hero comes back; leaving him to hold the pass, he does not.
    let lastStand = false;
    yield* heroCare(story, { rally: () => ({ x: mouth.x, y: mouth.y - 120 }), keepDown: (key) => key === "du" && lastStand });

    // The refugees: Reedholm's, and the ash wood's if they were freed.
    const walkers: Unit[] = [];
    const reedholmers = Math.max(3, story.vars.villagersSaved);
    for (let index = 0; index < reedholmers; index += 1) walkers.push(world.spawn(index % 2 ? CAST.villagerWoman : CAST.villager, FOLK, ring(PLACES.passSouth, 120, index, reedholmers + 6)));
    const emberFolk = story.vars.asheSaved ? 5 : 2;
    for (let index = 0; index < emberFolk; index += 1) walkers.push(world.spawn(CAST.refugee, FOLK, ring(PLACES.passSouth, 120, reedholmers + index, reedholmers + 6)));
    const ashe = story.vars.asheSaved ? world.spawn(CAST.ashe, FOLK, { x: PLACES.passSouth.x + 30, y: PLACES.passSouth.y }, { id: "ashe" }) : undefined;
    if (ashe) walkers.push(ashe);

    yield* stage.fadeTo(0, seconds(1.5));
    yield* stage.narrate("三天后。北方山口。");
    yield* stage.title("第四章 · 杜伯的誓言", "Chapter Four · Du's Oath");
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: mouth.x, y: mouth.y + 120, zoom: 1.1 });
      if (ig) yield* say(story, ig, "我从坡上看见了。烬族大军离这儿不到半天，巨像走在最后——走得很慢，可每走一步，地都在抖。");
      else yield* say(story, tess, "鸟都往北飞了。烬族大军离这儿不会超过半天。");
      yield* say(story, du, "难民要全过山口，少说也得一炷香。");
      yield* say(story, du, "这山口窄，三个人就能挡住一条路。你们带人走，我来守。");
      yield* say(story, lynn, "不行。");
      yield* say(story, du, "林恩。这是命令——");
      yield* say(story, du, "……好吧，我不是你的上级。这是请求。");
    });
    const choice = yield* stage.choose(
      "杜伯把盟约之盾插进山口的冻土里。难民在身后排成一条长线。",
      [
        { id: "stand", text: "“我们一起守。”——所有人留在山口。" },
        { id: "escort", text: "“……好。活着追上来。”——带难民先走，杜伯断后。" },
      ],
      { id: "pass", speaker: lynn },
    );
    story.vars.choices.pass = choice;
    const standing = choice === "stand";
    lastStand = !standing;
    yield* cutscene(story, function* () {
      if (standing) {
        yield* say(story, lynn, "我们一起守。你教过我的——守望者不把后背留给任何人，包括自己人。");
        yield* say(story, du, "（大笑）好丫头。那就让他们见识见识，沼泽里的人有多难啃。");
        yield* say(story, tess, "我去把荆棘种在山口两边。要进来，先流点血。");
      } else {
        yield* say(story, lynn, "……好。活着追上来，这也是请求。");
        yield* say(story, du, "我这把老骨头，最擅长的就是活着。去吧。");
        yield* say(story, tess, "老头。别逞强。");
        yield* say(story, du, "逞了一辈子，改不了了。");
      }
    });

    // ---- Tess's thorns across the mouth of the pass: whoever walks into them is held fast a moment.
    if (world.alive(tess)) {
      yield* cutscene(story, function* () {
        yield* stage.framing({ mode: "point", x: mouth.x, y: mouth.y + 260, zoom: 1.25 });
        yield* world.walk([tess], { x: mouth.x, y: mouth.y + 230 }, { limit: seconds(8) });
        yield* say(story, tess, "荆棘，醒醒。有客人要从这里过。");
        for (const [index, patch] of THORNS.entries()) {
          stage.mark("snare", { x: mouth.x + patch.x, y: mouth.y + patch.y }, { radius: 70 });
          world.effect("summon", { x: mouth.x + patch.x, y: mouth.y + patch.y }, seconds(1));
          if (index < 2) yield* beat(0.6);
        }
        yield* say(story, du, "好东西。比我年轻时的拒马管用。");
      });
      const held = new Set<string>();
      yield* every(seconds(0.5), function* thornsBite() {
        for (const patch of THORNS) {
          const at = { x: mouth.x + patch.x, y: mouth.y + patch.y };
          for (const foe of world.units({ owner: EMBER, within: { at, radius: 70 } })) {
            if (held.has(foe.id)) continue;
            held.add(foe.id);
            world.strike(tess, foe, 15, "spell");
            const pace = foe.speed;
            foe.speed = 0;
            yield* spawn(function* release() {
              yield* wait(seconds(3));
              const unit = world.unit(foe);
              if (unit && unit.speed === 0) unit.speed = pace;
            });
          }
        }
      }, "thorns");
    }

    // ---- The refugees file north through the pass.
    const through = new Set<string>();
    const lost = new Set<string>();
    const startTick = world.tick;
    const exodus = stage.objective({ zh: "让难民通过山口", en: "Get the refugees through the pass" });
    exodus.progress(`0/${walkers.length}`);
    yield* every(seconds(1), function* file() {
      for (const [index, walker] of walkers.entries()) {
        if (through.has(walker.id) || lost.has(walker.id)) continue;
        if (!world.alive(walker)) {
          lost.add(walker.id);
          continue;
        }
        if (REGIONS.passThrough.contains(walker)) {
          through.add(walker.id);
          exodus.progress(`${through.size}/${walkers.length}`);
          continue;
        }
        // One at a time through the narrows, a few seconds apart.
        if (walker.order.type === "idle" && world.tick >= startTick + seconds(4 + index * 6)) world.move([walker], ring(PLACES.passNorth, 200, index, walkers.length));
      }
    }, "exodus");

    // ---- The defenders.
    const hold = stage.objective(standing ? { zh: "守住山口 3 分钟", en: "Hold the pass for three minutes" } : { zh: "护送难民到山口北侧", en: "Escort the refugees north" });
    const holdMark = stage.mark("rally", standing ? { x: mouth.x, y: mouth.y + 170 } : PLACES.passNorth, { radius: 170, label: standing ? "守住山口" : "山口北侧" });
    yield* ensure(holdMark.remove);
    if (!standing) {
      // Du holds alone (with the two fen wardens, if they still live), under the story's hand.
      const rearguard = [du, ...["warden-wen", "warden-bo"].map((id) => world.unit(id)).filter((unit): unit is Unit => unit !== undefined)];
      for (const unit of rearguard) unit.owner = FOLK;
      yield* world.squad(FOLK, rearguard, { kind: "hold", at: { x: mouth.x, y: mouth.y + 170 }, leash: 260 }, { nerve: 0 });
    }
    yield* spawn(function* clock() {
      for (;;) {
        if (standing) hold.progress(`${Math.max(0, Math.ceil((startTick + seconds(HOLD_SECONDS) - world.tick) / 20))}s`);
        yield* wait(seconds(1));
      }
    });

    // ---- The Ember vanguard, wave after wave.
    for (const wave of WAVES) {
      yield* spawn(function* attack(): Operation<void> {
        yield* wait(seconds(wave.at));
        const band = [
          ...world.spawnGroup(CAST.ashRaider, EMBER, EMBER_GATE, wave.raiders, { spread: 90 }),
          ...world.spawnGroup(CAST.cinderHound, EMBER, { x: EMBER_GATE.x + 100, y: EMBER_GATE.y - 60 }, wave.hounds, { spread: 60 }),
          ...world.spawnGroup(CAST.obsidianGuard, EMBER, { x: EMBER_GATE.x + 150, y: EMBER_GATE.y + 40 }, wave.guards, { spread: 50 }),
          ...world.spawnGroup(CAST.pyremancer, EMBER, { x: EMBER_GATE.x + 240, y: EMBER_GATE.y }, wave.pyres, { spread: 40 }),
        ];
        for (const unit of band) if (unit.variant === CAST.pyremancer.id) yield* empower(world, unit, [fireRain({ radius: 105, damage: 40, windUp: 1.6, least: 2 })]);
        stage.notice({ zh: "烬族先锋冲向山口！", en: "The Ember vanguard charges the pass!" }, "warn");
        const squad = yield* world.squad(EMBER, band, { kind: "attack", at: { x: mouth.x, y: mouth.y + 100 } }, { nerve: 0.4 });
        yield* squad.defeated();
      }, "wave");
    }

    // The worst moment: a wave that goes for Du alone.
    yield* spawn(function* duSurrounded(): Operation<void> {
      yield* wait(seconds(96));
      if (!world.alive(du)) return;
      const knot = world.spawnGroup(CAST.obsidianGuard, EMBER, { x: du.x + 260, y: du.y + 200 }, 3, { spread: 40 });
      stage.bark(knot[0]!, "杀了那个拿盾的老头！", { tone: "shout" });
      world.attack(knot, du);
      yield* until(() => !world.alive(du) || du.hp < du.maxHp * 0.35);
      if (!world.alive(du)) return;
      if (standing && world.alive(tess)) {
        yield* say(story, tess, "撑住，老头！", { tone: "shout", span: seconds(1.5) });
        world.effect("guardianField", du, seconds(2), { radius: 70 });
        world.heal(du, du.maxHp * 0.55);
        world.afflict(du, "guardian", seconds(2.5));
        stage.bark(du, "咳……欠你一次。");
      }
      const squad = yield* world.squad(EMBER, knot, { kind: "attack", at: du }, { nerve: 0 });
      yield* squad.defeated();
    }, "duSurrounded");

    // Holding: the time runs out and the last of the vanguard falls. Escorting: the refugees are through.
    yield* until(() => world.tick >= startTick + seconds(HOLD_SECONDS) && (standing ? world.units({ owner: EMBER }).length <= 2 : true) && walkers.every((walker) => through.has(walker.id) || lost.has(walker.id) || !world.alive(walker)));
    if (!standing) story.vars.duFell = true;
    hold.done();
    exodus.done();
    story.vars.refugeesThrough = through.size;
    reward(story, 120);

    if (!standing) {
      // Du's last stand, seen from the north side of the pass.
      yield* cutscene(story, function* () {
        yield* stage.framing({ mode: "follow", unitIds: [du.id], zoom: 1.35 });
        const host = world.spawnGroup(CAST.obsidianGuard, EMBER, { x: du.x + 220, y: du.y + 160 }, 4, { spread: 60 });
        world.attack(host, du);
        yield* say(story, du, "来吧。我还剩一口气，够你们几个排队的。", { tone: "shout" });
        yield* until(() => !world.alive(du) || du.hp < du.maxHp * 0.2);
        if (world.alive(du)) {
          yield* say(story, du, "林恩……替我看着那面盾。它比我更该活着。");
          world.strike(host[0]!, du, 9999, "melee");
        }
        yield* beat(2);
        yield* say(story, lynn, "杜伯——！", { tone: "shout" });
      });
    }

    // ---- Vashka on the ridge.
    sweep(story, [EMBER]);
    const vashka = world.spawn(CAST.vashka, EMBER, PLACES.eastRidge, { id: "vashka" });
    const escort = world.spawnGroup(CAST.obsidianGuard, EMBER, ring(PLACES.eastRidge, 90, 1, 4), 4, { spread: 90 });
    yield* cutscene(story, function* () {
      world.afflict(vashka, "guardian", seconds(60));
      yield* stage.framing({ mode: "follow", unitIds: [vashka.id], zoom: 1.2 });
      stage.quake(3, seconds(1.5));
      yield* beat(1.5);
      if (!story.vars.duFell && world.alive(du)) {
        yield* say(story, vashka, "老兵。二十年了，你的盾还是这么难看。");
        yield* say(story, du, "瓦什卡。我当年该让你把那一矛刺下来。");
        yield* say(story, vashka, "你当年让我活，是想让我记住你们的仁慈。我记住了。");
        yield* say(story, vashka, "我记住了——仁慈，是强者赏给弱者的东西。现在，轮到我赏了。");
      } else {
        yield* say(story, vashka, "那个老兵……他死的时候，在笑。");
        yield* say(story, vashka, "二十年前他也是这样笑的。好像全世界的火，都烧不到他。");
        yield* say(story, lynn, "你杀了救过你命的人。");
        yield* say(story, vashka, "我还给了他一场体面的死。这比他给我的，多。");
      }
      yield* say(story, lynn, "烧了心木，你的族人也会死。");
      yield* say(story, vashka, "他们本来就在死。慢慢地、安静地、体面地死。");
      yield* say(story, vashka, "我给他们的，至少是一场火。", { tone: "shout" });
      if (ig) yield* say(story, ig, "瓦什卡！难民营地里的人，你也当柴烧吗？！", { tone: "shout" });
      if (ig) yield* say(story, vashka, "伊格。我记得你。逃兵的命，不值得我浪费一句话。");
      yield* say(story, vashka, "心木下见。", { tone: "shout" });
      stage.quake(6, seconds(1.2));
      yield* eruption(world, vashka, { x: mouth.x, y: mouth.y - 380 }, 180, 5, 0);
    });
    world.remove(vashka);
    for (const guard of escort) world.remove(guard);
    bridge.state = "ruined";
    if (!standing) {
      for (const id of ["warden-wen", "warden-bo"]) {
        const warden = world.unit(id);
        if (warden) warden.owner = PLAYER;
      }
    }
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "follow", unitIds: [lynn.id], zoom: 1.3 });
      yield* say(story, tess, "他把桥烧了。他要绕远路去老林子——带着巨像，快不了。");
      if (!story.vars.duFell) yield* say(story, du, "……他会去老林子。我们得比他快。");
      else yield* say(story, lynn, "我们抄近路。在他之前到老林子。然后——替杜伯把账算清楚。");
      yield* stage.fadeTo(1, seconds(2));
    });
    // The refugees go on north to the grove ahead of the wardens.
    for (const walker of walkers) world.remove(walker);
    if (story.vars.duFell) story.party.leave(CAST.du.id);
  },
};

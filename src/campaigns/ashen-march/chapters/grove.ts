import type { Unit } from "../../../shared/types";
import type { Chapter } from "../../../story/campaign";
import { ensure, scope, spawn, type Operation } from "../../../story/kernel";
import { every, until, wait } from "../../../story/ops";
import { empower } from "../../../story/powers";
import { distance, ring, toward } from "../../../story/region";
import { seconds } from "../../../story/time";
import { CAST } from "../cast";
import { army, award, beat, bringHero, cutscene, EMBER, FOLK, HERO_IDS, heroCare, reward, say, sweep, type AshenStory, type Vars } from "../common";
import { refreshUnitStats } from "../../../shared/sim";
import { PLACES } from "../places";
import { emberBrood, eruption, fireRain, flameWave, houndCall, magmaSlam } from "../powers";

// 第五章 · 灰烬之心 - The Old Grove. Elder Moss wakes the heartwood's treants; the Ember host comes in waves with Oru at
// its head; then the Cinder Colossus walks out of the ash, and last of all Vashka himself. How the story ends turns on
// what the wardens chose along the way: whether Ig is there to break the colossus's seal, whether Du is there to face
// the boy he spared, and whether Vashka, beaten, is spared in his turn.

const HEART = PLACES.heartwood;
const DEFENSE = { x: HEART.x + 420, y: HEART.y + 120 };
const EAST = PLACES.colossusRoad;

export const grove: Chapter<Vars> = {
  id: "grove",
  title: { zh: "第五章 · 灰烬之心", en: "Chapter Five · Heart of Ash" },
  *play(story) {
    const { world, stage } = story;
    stage.clearProps(["deadTree", "cairn", "bridge"]);
    const heartwood = stage.prop("heartwood", HEART, { scale: 2.6 });
    for (const spot of [[2000, 2500], [2800, 1800], [1900, 1900], [2900, 2700], [3300, 2000], [2100, 2900]]) stage.prop("tree", { x: spot[0]!, y: spot[1]! }, { scale: 1.5 });
    for (const spot of [[4600, 2300], [5200, 2600], [5800, 2350]]) stage.prop("ashPile", { x: spot[0]!, y: spot[1]! }, { scale: 1.4 });

    const lynn = yield* bringHero(story, "lynn", { x: DEFENSE.x - 60, y: DEFENSE.y - 40 });
    const du = story.vars.duFell ? undefined : yield* bringHero(story, "du", { x: DEFENSE.x + 20, y: DEFENSE.y + 30 });
    const tess = yield* bringHero(story, "tess", { x: DEFENSE.x - 100, y: DEFENSE.y + 50 });
    const ig = story.vars.igFate === "joined" ? yield* bringHero(story, "ig", { x: DEFENSE.x + 40, y: DEFENSE.y - 60 }) : undefined;
    const soldiers = army(story).filter((unit) => !Object.values(HERO_IDS).includes(unit.id));
    soldiers.forEach((unit, index) => world.place(unit, ring({ x: DEFENSE.x - 40, y: DEFENSE.y + 20 }, 170, index, soldiers.length)));
    yield* heroCare(story, { rally: () => ({ x: HEART.x + 180, y: HEART.y + 60 }), keepDown: (key) => key === "du" && story.vars.duFell });
    const elder = world.spawn(CAST.elder, FOLK, { x: HEART.x + 90, y: HEART.y + 110 }, { id: "elder" });
    const refugees = world.spawnGroup(CAST.refugee, FOLK, { x: HEART.x - 380, y: HEART.y + 60 }, 3, { spread: 60 }).concat(world.spawnGroup(CAST.villager, FOLK, { x: HEART.x - 420, y: HEART.y - 60 }, 3, { spread: 60 }));

    yield* stage.fadeTo(0, seconds(1.5));
    yield* stage.narrate("老林子。心木在这里站了一千年，比盟约老，比战争老，比两族的名字都老。");
    yield* stage.title("第五章 · 灰烬之心", "Chapter Five · Heart of Ash");
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: HEART.x + 60, y: HEART.y + 10, zoom: 1.05 });
      yield* say(story, elder, "守望者之女，林恩……你们带来了烬族的孩子，也带来了烬族的火。");
      yield* say(story, tess, "长老。我们需要心木的力量。");
      yield* say(story, elder, "心木不是武器，草药师。它不会为谁去杀人。");
      yield* say(story, elder, "但它有根。根会记得，谁守护过它。");
      yield* stage.framing({ mode: "point", x: HEART.x + 150, y: HEART.y + 150, zoom: 1.1 });
      stage.quake(2, seconds(1.5));
      yield* beat(1);
      for (const [index, spot] of [0, 1, 2].map((i) => [i, ring({ x: HEART.x + 260, y: HEART.y + 180 }, 150, i, 3)] as const)) {
        world.effect("summon", spot, seconds(1.4));
        world.spawn(CAST.treant, FOLK, spot, { id: `treant-${index}` });
        yield* beat(0.5);
      }
      yield* say(story, elder, "起来吧，孩子们。有客人要来了。");
      if (du) {
        yield* say(story, du, "林恩。有样东西，我替你父亲保管了十五年。");
        yield* say(story, du, "他的箭袋。他说，等你不再需要人教的时候，交给你。");
        award(story, "lynn", "dawnstarQuiver");
        yield* say(story, lynn, "……谢谢你，杜伯。为了所有的事。");
        yield* say(story, du, "谢什么，仗还没打呢。");
      } else {
        yield* say(story, tess, "林恩，杜伯的行囊里有样东西，写着你的名字。");
        yield* say(story, tess, "一个旧箭袋，箭羽上缝着晨星。纸条上写：“她已经不需要人教了。”");
        award(story, "lynn", "dawnstarQuiver");
        yield* say(story, lynn, "……", { tone: "think" });
      }
    });
    const treants = [0, 1, 2].map((index) => world.unit(`treant-${index}`)).filter((unit): unit is Unit => unit !== undefined);
    const grovekeepers = yield* world.squad(FOLK, [elder, ...treants], { kind: "hold", at: DEFENSE, leash: 420 }, { nerve: 0 });

    const guard = stage.objective({ zh: "守护心木", en: "Protect the Heartwood" });
    const heartHp = { now: 100 };
    guard.progress("100%");
    const rally = stage.mark("rally", DEFENSE, { radius: 200, label: "守住林口" });
    yield* ensure(rally.remove);
    // The heartwood suffers whatever Ember fire reaches it; below a third, the grove begins to die.
    yield* every(seconds(1), function* scorch() {
      const burners = world.units({ owner: EMBER }).filter((unit) => distance(unit, HEART) < 260).length;
      if (burners === 0) return;
      heartHp.now = Math.max(0, heartHp.now - burners * 0.6);
      guard.progress(`${Math.round(heartHp.now)}%`);
      if (heartHp.now < 50 && heartwood.state !== "scorched") heartwood.state = "scorched";
    }, "heartwood");

    // ---- Phase one: the host, and Oru at its head.
    const phaseOne = seconds(130);
    const started = world.tick;
    const waves: [number, () => Unit[]][] = [
      [5, () => [...world.spawnGroup(CAST.ashRaider, EMBER, EAST, 6, { spread: 90 }), ...world.spawnGroup(CAST.cinderHound, EMBER, { x: EAST.x, y: EAST.y + 120 }, 4)]],
      [45, () => [...world.spawnGroup(CAST.ashRaider, EMBER, EAST, 5), ...world.spawnGroup(CAST.obsidianGuard, EMBER, { x: EAST.x + 80, y: EAST.y }, 3), ...world.spawnGroup(CAST.pyremancer, EMBER, { x: EAST.x + 160, y: EAST.y }, 2)]],
      [85, () => [...world.spawnGroup(CAST.ashRaider, EMBER, EAST, 6), ...world.spawnGroup(CAST.cinderHound, EMBER, { x: EAST.x, y: EAST.y - 120 }, 4), ...world.spawnGroup(CAST.pyremancer, EMBER, { x: EAST.x + 160, y: EAST.y }, 2)]],
    ];
    for (const [at, bring] of waves) {
      yield* spawn(function* wave(): Operation<void> {
        yield* wait(seconds(at));
        const band = bring();
        for (const unit of band) if (unit.variant === CAST.pyremancer.id) yield* empower(world, unit, [fireRain({ radius: 105, damage: 42, windUp: 1.6, least: 2 })]);
        stage.notice({ zh: "烬族大军逼近老林子！", en: "The Ember host nears the Old Grove!" }, "warn");
        const squad = yield* world.squad(EMBER, band, { kind: "attack", at: HEART }, { nerve: 0.3 });
        yield* squad.defeated();
      }, "wave");
    }
    const oruReturns = yield* spawn(function* oruReturns(): Operation<void> {
      yield* wait(seconds(60));
      const oru = world.spawn(CAST.oru, EMBER, { x: EAST.x - 300, y: EAST.y }, { id: "oru" });
      oru.hp = Math.round(oru.maxHp * 0.7);
      yield* empower(world, oru, [fireRain({ radius: 130, damage: 55, windUp: 1.5, least: 1, reach: 380 }), houndCall(2, 22)]);
      const escort = world.spawnGroup(CAST.obsidianGuard, EMBER, { x: EAST.x - 250, y: EAST.y + 60 }, 2);
      yield* world.squad(EMBER, [oru, ...escort], { kind: "attack", at: DEFENSE }, { nerve: 0 });
      const mark = stage.mark("target", oru, { radius: 46, label: "欧鲁" });
      yield* ensure(mark.remove);
      stage.bark(oru, "我说过——你们会和老林子一起烧成灰！", { tone: "shout", span: seconds(3) });
      yield* spawn(function* sky() {
        yield* until(() => oru.hp < oru.maxHp * 0.5);
        stage.bark(oru, "天火！", { tone: "shout" });
        yield* eruption(world, oru, centerOf(army(story)), 240, 6, 40);
      });
      yield* until(() => !world.alive(oru));
      mark.remove();
      stage.bark(lynn, "这次，你跑不掉了。");
      reward(story, 100);
    }, "oru");
    // The host is spent when the time is up and none of it is still near the grove; stragglers out on the plain turn
    // back to wait for the colossus.
    yield* until(() => world.tick >= started + phaseOne && world.units({ owner: EMBER, within: { at: HEART, radius: 1500 } }).length <= 1 && oruReturns.state !== "running");
    for (const straggler of world.units({ owner: EMBER })) world.remove(straggler);
    reward(story, 120);

    // ---- Phase two: the Cinder Colossus.
    const colossus = world.spawn(CAST.colossus, EMBER, { x: EAST.x - 600, y: EAST.y }, { id: "colossus" });
    yield* cutscene(story, function* () {
      stage.quake(5, seconds(3));
      yield* stage.framing({ mode: "follow", unitIds: [colossus.id], zoom: 0.85 });
      world.move([colossus], toward(colossus, DEFENSE, 300));
      yield* beat(2.5);
      yield* say(story, tess, "那就是……巨像。", { tone: "whisper" });
      if (ig) yield* say(story, ig, "上一场战争里造的。烧的是整座村子的圣火余烬。灰原的人叫它“熔烬巨像”——说它心里住着一千个没说完的遗言。");
      yield* say(story, elder, "根，醒来。", { tone: "shout" });
      if (du) yield* say(story, du, "再大的东西，腿也只有两条。砍腿！");
      else yield* say(story, lynn, "再大的东西，腿也只有两条。瞄准它的腿！");
    });
    const titan = stage.objective({ zh: "摧毁熔烬巨像", en: "Destroy the Cinder Colossus" });
    const colossusMark = stage.mark("target", colossus, { radius: 80, label: "熔烬巨像" });
    yield* ensure(colossusMark.remove);
    const colossusPowers = yield* empower(world, colossus, [magmaSlam(), emberBrood()], { think: seconds(0.5) });
    const colossusBrain = yield* world.squad(EMBER, [colossus], { kind: "attack", at: HEART }, { nerve: 0 });
    grovekeepers.intent = { kind: "hunt", targetIds: [colossus.id] };
    // The fen beacon, if it was lit, brought the watch's riders.
    if (story.vars.beaconLit) {
      yield* spawn(function* riders(): Operation<void> {
        yield* wait(seconds(25));
        const riders = world.spawnGroup(CAST.groveRider, FOLK, { x: HEART.x - 700, y: HEART.y + 300 }, 5, { spread: 90 });
        stage.notice({ zh: "烽火召来的守望塔骑手赶到了！", en: "The riders the beacon called have come!" }, "gain");
        stage.bark(riders[0]!, "守望塔的骑手，冲锋！", { tone: "shout" });
        const charge = yield* world.squad(FOLK, riders, { kind: "hunt", targetIds: [colossus.id] }, { nerve: 0 });
        yield* charge.defeated();
      }, "riders");
    }
    yield* spawn(function* colossusPhases(): Operation<void> {
      yield* until(() => colossus.hp < colossus.maxHp * 0.55);
      if (ig && world.alive(ig)) {
        yield* cutscene(story, function* () {
          yield* stage.framing({ mode: "follow", unitIds: [ig.id, colossus.id], zoom: 1.0 });
          yield* say(story, ig, "它的核心是用难民营地的圣火余烬点着的——那个封印，我在营地里见过！", { tone: "shout" });
          yield* say(story, ig, "掩护我！", { tone: "shout" });
          world.move([ig], toward(colossus, ig, colossus.radius + 30));
          yield* until(() => !world.alive(ig) || distance(ig, colossus) < colossus.radius + 60);
          world.effect("chainLightning", colossus, seconds(1.2), { fromX: ig.x, fromY: ig.y, toX: colossus.x, toY: colossus.y - 40 });
          world.effect("guardianField", colossus, seconds(2), { radius: 90 });
          stage.quake(7, seconds(1.2));
          yield* say(story, ig, "睡吧，一千个遗言。", { tone: "whisper" });
        });
        // The seal breaks it: it becomes another thing (a variant of its own, without the armor) and stands still a while.
        colossus.variant = CAST.brokenColossus.id;
        refreshUnitStats(world.game, colossus);
        world.strike(ig, colossus, 600, "spell");
        stage.float({ zh: "封印破碎！护甲瓦解", en: "Seal broken! Armor shattered" }, colossus, { color: "#8e2a1c", size: 20, span: seconds(3) });
        yield* freeze(story, colossus, seconds(6));
      } else {
        yield* say(story, elder, "根——缠住它！", { tone: "shout" });
        world.effect("guardianField", colossus, seconds(2), { radius: 90 });
        yield* freeze(story, colossus, seconds(4));
      }
      yield* until(() => colossus.hp < colossus.maxHp * 0.3);
      stage.bark(colossus, "……（熔核在尖啸）", { tone: "shout", span: seconds(2) });
      for (;;) {
        yield* eruption(world, colossus, centerOf(army(story)), 260, 5, 45);
        yield* wait(seconds(7));
      }
    }, "colossusPhases");
    yield* until(() => !world.alive(colossus));
    colossusPowers.stop();
    colossusBrain.task.halt();
    colossusMark.remove();
    titan.done();
    reward(story, 200);
    const fallenAt = { x: colossus.x, y: colossus.y };
    stage.quake(10, seconds(2));
    for (const [index, spot] of Array.from({ length: 6 }, (_, i) => ring(fallenAt, 80, i, 6)).entries()) world.effect(index % 2 ? "flameBurn" : "chargeImpact", spot, seconds(1.5), { fromX: fallenAt.x, fromY: fallenAt.y, toX: spot.x, toY: spot.y });
    stage.prop("ashPile", fallenAt, { scale: 3 });
    for (const hound of world.units({ owner: EMBER })) world.remove(hound);

    // ---- Phase three: Vashka.
    const vashka = world.spawn(CAST.vashka, EMBER, { x: EAST.x - 900, y: EAST.y - 80 }, { id: "vashka" });
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "follow", unitIds: [vashka.id], zoom: 1.2 });
      world.move([vashka], toward(vashka, DEFENSE, 500));
      yield* beat(3);
      yield* say(story, vashka, "巨像倒了。一千个遗言，终于说完了。");
      if (du) {
        yield* say(story, vashka, "老兵。我们之间，还差一个结局。");
        yield* say(story, du, "瓦什卡。那天你盯着我的脸，是想记住仇人的样子吗？");
        yield* say(story, vashka, "……不。我是想记住，一个强到可以饶人的人，长什么样。");
        yield* say(story, du, "那你记错了。饶你，不是因为我强。是因为我也害怕。");
      } else {
        yield* say(story, vashka, "守望者。那个老兵教过你什么？");
        yield* say(story, lynn, "他教过我，火和盾，不该分给不同的人。");
      }
      yield* say(story, vashka, "来吧。用你们的仁慈，挡住我的火。", { tone: "shout" });
    });
    const final = stage.objective({ zh: "击败焚誓者瓦什卡", en: "Defeat Vashka the Unquenched" });
    const vashkaMark = stage.mark("target", vashka, { radius: 50, label: "瓦什卡" });
    yield* ensure(vashkaMark.remove);
    const vashkaPowers = yield* empower(world, vashka, [flameWave(), houndCall(3, 26)]);
    const vashkaBrain = yield* world.squad(EMBER, [vashka], { kind: "hunt", targetIds: Object.values(HERO_IDS) }, { nerve: 0 });
    grovekeepers.intent = { kind: "hunt", targetIds: [vashka.id] };
    yield* spawn(function* oath(): Operation<void> {
      yield* until(() => vashka.hp < vashka.maxHp * 0.5);
      stage.bark(vashka, "以焚誓之名——我不熄灭！", { tone: "shout", span: seconds(3) });
      world.effect("experienceBurst", vashka, seconds(1.6));
      world.rewrite(CAST.vashka.id, { ...CAST.vashka.rules, attackDamage: 52, regenPerSecond: 7 });
      world.heal(vashka, vashka.maxHp * 0.2);
      const guards = world.spawnGroup(CAST.obsidianGuard, EMBER, ring(vashka, 120, 0, 1), 3, { spread: 100 });
      const bodyguard = yield* world.squad(EMBER, guards, { kind: "escort", unitId: vashka.id }, { nerve: 0 });
      if (du) yield* say(story, du, "瓦什卡！够了！你的族人不需要又一个烈士！", { tone: "shout" });
      yield* bodyguard.defeated();
    });
    // Beaten, not killed: at the last he goes down on one knee.
    yield* until(() => vashka.hp < vashka.maxHp * 0.12);
    world.afflict(vashka, "guardian", seconds(120));
    vashkaPowers.stop();
    vashkaBrain.task.halt();
    vashka.owner = FOLK;
    vashka.order = { type: "idle" };
    for (const unit of world.units({ owner: EMBER })) world.remove(unit);
    vashkaMark.remove();
    final.done();
    guard.done();
    reward(story, 300);

    yield* cutscene(story, function* () {
      const party = [lynn, tess, ...(du ? [du] : []), ...(ig ? [ig] : [])];
      yield* story.world.walk(party, ring(vashka, 110, 0, 1), { limit: seconds(12) });
      yield* stage.framing({ mode: "follow", unitIds: [vashka.id, lynn.id], zoom: 1.45 });
      yield* say(story, vashka, "……动手吧。烬族的战士，不跪着活。");
    });
    const verdict = yield* stage.choose(
      "瓦什卡单膝跪在灰里，长矛断成两截。他没有求饶。",
      [
        { id: "spare", text: "“起来。”——饶了他。" },
        { id: "end", text: "“你烧了太多东西。”——终结他。" },
      ],
      { id: "vashka", speaker: lynn },
    );
    story.vars.choices.vashka = verdict;
    story.vars.vashkaSpared = verdict === "spare";
    const pyreSpot = { x: HEART.x + 200, y: HEART.y + 260 };
    if (verdict === "spare") {
      yield* cutscene(story, function* () {
        yield* say(story, vashka, "……为什么？");
        yield* say(story, lynn, "因为二十年前，有人饶了你。这笔债，总得有人不再往下传。");
        yield* say(story, elder, "心木不能烧，焚誓者。但它可以给出一粒火种——给一个愿意背着它、走回灰原的人。");
        const pyre = stage.prop("pyre", pyreSpot, { scale: 1.2 });
        world.effect("summon", pyreSpot, seconds(1.6));
        yield* beat(1.2);
        pyre.state = "lit";
        yield* say(story, vashka, "……这是……圣火的颜色。");
        yield* say(story, elder, "心木的火，只在被带走的时候才会燃烧。走吧。把它带回你们的山里。");
        if (du) yield* say(story, du, "小子。这一回，我不送你了。你自己走得回去。");
        if (du) yield* say(story, vashka, "……嗯。这一回，我记住的，是你的背影。");
        if (ig) yield* say(story, ig, "我跟他一起回去。总得有人看着他，别把火又弄灭了。");
        world.move([vashka], { x: EAST.x + 800, y: EAST.y });
        yield* beat(3);
        yield* stage.fadeTo(1, seconds(2.5));
      });
    } else {
      yield* cutscene(story, function* () {
        yield* say(story, lynn, "你烧了太多东西。");
        world.strike(lynn, vashka, 99999, "ranged");
        yield* beat(2);
        if (du) yield* say(story, du, "……他到最后，也没有求饶。");
        yield* say(story, elder, "火熄了。可灰原上的火，也快熄了。");
        yield* say(story, tess, "那就让我们带着药，去灰原看看。能救几个，是几个。");
        yield* stage.fadeTo(1, seconds(2.5));
      });
    }
    sweep(story, [EMBER]);
    yield* epilogue(story);
    for (const refugee of refugees) world.remove(refugee);
  },
};

// Holds a unit still (no step, no blow) for a while; its speed comes back however the hold ends.
function* freeze(story: AshenStory, unit: Unit, span: ReturnType<typeof seconds>): Operation<void> {
  yield* scope(function* held() {
    const pace = unit.speed;
    const mark = story.stage.mark("snare", unit, { radius: unit.radius + 20 });
    yield* ensure(() => {
      mark.remove();
      const live = story.world.unit(unit);
      if (live && live.speed === 0) live.speed = pace;
    });
    unit.speed = 0;
    unit.cooldown = Math.max(unit.cooldown, span);
    yield* wait(span);
  }, "freeze");
}

function* epilogue(story: AshenStory): Operation<void> {
  const { stage, vars } = story;
  yield* stage.narrate("尾声");
  yield* stage.narrate(vars.villagersSaved >= 6 ? "芦苇渡在那年冬天重建。渡口的船，比从前多了一条。" : "芦苇渡在那年冬天重建。只是渡口边，多了几座新坟。");
  if (vars.igFate === "joined") yield* stage.narrate(vars.asheSaved ? "伊格和艾舍回到了灰原。艾舍后来成了烬族第一个在沼泽学医的人。" : "伊格回到了灰原，一个人。他每年秋天都会在界碑上系一根红绳。");
  else if (vars.igFate === "trial") yield* stage.narrate("伊格在守望塔的议会上被判无罪。杜伯的老朋友，果然还在议会里。");
  else yield* stage.narrate("伊格的名字，没有人再提起。只有苔丝的药园里，多了一株从灰原带回来的红花。");
  if (vars.choices.bao) yield* stage.narrate(vars.choices.bao === "comfort" ? "老鲍在渡口边种了一棵柳树。他说，阿木走的时候不疼。" : "老鲍在渡口边种了一棵柳树。每年春天，他都去守望塔送一篮新摘的芦笋。");
  yield* stage.narrate(vars.duFell ? "山口的冻土里，插着一面盾。每个经过的人，都会在它面前停一停。" : "杜伯回到了守望塔。他的膝盖依旧能预报天气，只是再也没有预报过战争。");
  yield* stage.narrate(vars.vashkaSpared ? "那年开春，灰原深处的圣火重新燃起。它的颜色，和心木的叶子一样绿。" : "灰原的圣火终于熄灭了。许多烬族人南下，来到沼泽。这一次，界碑为他们打开了。");
  yield* stage.narrate("而林恩，依旧每天清晨沿着河巡逻。三块界碑，一块不少。");
  yield* stage.title("灰烬边境", "The Ashen March · 完", seconds(7));
  yield* wait(seconds(2));
}

function centerOf(units: readonly Unit[]) {
  if (units.length === 0) return { x: DEFENSE.x, y: DEFENSE.y };
  return { x: units.reduce((sum, unit) => sum + unit.x, 0) / units.length, y: units.reduce((sum, unit) => sum + unit.y, 0) / units.length };
}

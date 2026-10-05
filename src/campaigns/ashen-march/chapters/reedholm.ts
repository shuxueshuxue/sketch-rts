import type { Unit } from "../../../shared/types";
import type { Chapter } from "../../../story/campaign";
import { ensure, never, race, spawn, type Operation } from "../../../story/kernel";
import { each, every, until, wait } from "../../../story/ops";
import { empower } from "../../../story/powers";
import { distance, ring, toward, type Point } from "../../../story/region";
import type { Prop } from "../../../story/stage";
import type { Squad } from "../../../story/world";
import { seconds } from "../../../story/time";
import { CAST } from "../cast";
import { award, beat, bringHero, cutscene, EMBER, FOLK, HERO_IDS, heroCare, marked, PLAYER, reward, say, sweep, type AshenStory, type Vars } from "../common";
import { PLACES, REGIONS } from "../places";
import { cleave, houndCall, mendingRain, thornSnare } from "../powers";

// 第一章 · 芦苇渡之火 - Reedholm burns. The villagers hide in their huts and run for the ford when the way is clear; raider
// bands walk the village setting huts alight and cut down whoever they catch; Tess holds her hut with thorns and calls
// for help; Kharn the Brand waits in the square for someone worth fighting.

const HUT_SPOTS: Point[] = [
  { x: 4420, y: 8420 },
  { x: 4640, y: 8300 },
  { x: 4900, y: 8380 },
  { x: 5050, y: 8620 },
  { x: 4980, y: 8900 },
  { x: 4720, y: 9020 },
  { x: 4460, y: 8880 },
  { x: 4350, y: 8650 },
  { x: 4700, y: 8640 },
];

// Reedholm's huts, docks and fences on the map; `burning` of them already alight.
export function villageScenery(story: AshenStory, options: { burning: number }): { huts: Prop[]; boat: Prop } {
  const { stage } = story;
  stage.clearProps(["hut", "dock", "boat", "well", "fence"]);
  const huts = HUT_SPOTS.map((spot, index) => stage.prop("hut", spot, { scale: 1.25, flip: index % 2 === 1, ...(index < options.burning ? { state: "burning" } : {}) }));
  stage.prop("well", PLACES.villageSquare);
  stage.prop("dock", { x: PLACES.ford.x + 40, y: PLACES.ford.y + 30 }, { scale: 1.2 });
  const boat = stage.prop("boat", { x: PLACES.ford.x + 120, y: PLACES.ford.y - 20 }, { scale: 1.3 });
  stage.prop("fence", { x: 4520, y: 8230 });
  stage.prop("fence", { x: 4880, y: 9080 }, { flip: true });
  return { huts, boat };
}

export const reedholm: Chapter<Vars> = {
  id: "reedholm",
  title: { zh: "第一章 · 芦苇渡之火", en: "Chapter One · Fire at Reedholm" },
  *play(story) {
    const { world, stage } = story;
    const { huts, boat } = villageScenery(story, { burning: 3 });
    for (const spot of [[3950, 8250], [3900, 8080], [4150, 8050], [5250, 8350], [5450, 8000]]) stage.prop("reeds", { x: spot[0]!, y: spot[1]! }, { scale: 1.3 });
    const tessHut = stage.prop("hut", PLACES.tessHut, { scale: 1.1 });

    const lynn = yield* bringHero(story, "lynn", PLACES.reedholmWest);
    const du = yield* bringHero(story, "du", ring(PLACES.reedholmWest, 60, 1, 3));
    const wardens = ["warden-wen", "warden-bo"].map((id) => world.unit(id)).filter((unit): unit is Unit => unit !== undefined);
    wardens.forEach((warden, index) => world.place(warden, ring(PLACES.reedholmWest, 90, index + 2, 5)));
    yield* heroCare(story, { downtime: seconds(18) });

    // The ferrywoman keeps the boat; the villagers hide in their huts.
    const mei = world.spawn(CAST.villagerWoman, FOLK, { x: PLACES.ford.x - 30, y: PLACES.ford.y + 40 });
    stage.cast(mei, { name: "老渡工梅", color: "#8a6a3a" });
    const hiding = [1, 2, 3, 5, 6, 7, 8].map((hut, index) => ({ hut, count: index % 3 === 0 ? 2 : 1, out: false, burningSince: undefined as number | undefined, mark: undefined as { remove(): void } | undefined }));
    const total = hiding.reduce((sum, entry) => sum + entry.count, 0);
    const villagers: Unit[] = [];

    // Tess, at bay in her hut, her thorns keeping the raiders at arm's length.
    const tess = world.spawn(CAST.tess, FOLK, { x: PLACES.tessHut.x + 30, y: PLACES.tessHut.y + 60 }, { id: HERO_IDS.tess });
    stage.cast(tess, { name: CAST.tess.name, color: CAST.tess.color });
    const tessAlone = yield* empower(world, tess, [thornSnare(), mendingRain(() => 1)]);
    const tessThorns = yield* every(seconds(2), function* thorns() {
      world.afflict(tess, "guardian", seconds(2.3));
    }, "tess:thorns");
    const thornRing = stage.mark("snare", { x: PLACES.tessHut.x + 30, y: PLACES.tessHut.y + 60 }, { radius: 90 });
    yield* ensure(thornRing.remove);

    const bands = [
      world.spawnGroup(CAST.ashRaider, EMBER, { x: 4650, y: 8250 }, 3, { spread: 50 }).concat(world.spawnGroup(CAST.cinderHound, EMBER, { x: 4700, y: 8200 }, 2)),
      world.spawnGroup(CAST.ashRaider, EMBER, { x: 4850, y: 9000 }, 3, { spread: 50 }),
      world.spawnGroup(CAST.ashRaider, EMBER, { x: 5050, y: 8500 }, 2, { spread: 40 }).concat(world.spawnGroup(CAST.cinderHound, EMBER, { x: 5100, y: 8450 }, 2)),
    ];
    const besiegers = world.spawnGroup(CAST.ashRaider, EMBER, { x: PLACES.tessHut.x + 200, y: PLACES.tessHut.y + 140 }, 3, { spread: 50 });
    // Kharn watches from the rise north of the village, untouchable (the story keeps him out of it) until his moment.
    const perch = { x: 4700, y: 7820 };
    const kharn = world.spawn(CAST.kharn, EMBER, perch, { id: "kharn" });
    const guards = world.spawnGroup(CAST.ashRaider, EMBER, ring(perch, 60, 0, 1), 2, { spread: 70 });
    const aloof = yield* spawn(function* aloof(): Operation<void> {
      yield* every(seconds(1), function* keepOut() {
        for (const unit of [kharn, ...guards]) {
          world.afflict(unit, "guardian", seconds(1.2));
          if (world.alive(unit)) unit.order = { type: "move", x: perch.x + (unit === kharn ? 0 : 50), y: perch.y + 20 };
        }
      }, "kharn:aloof");
      yield* never();
    }, "kharn:aloof");

    yield* stage.fadeTo(0, seconds(1.5));
    yield* stage.title("第一章 · 芦苇渡之火", "Chapter One · Fire at Reedholm");
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: PLACES.reedholm.x - 200, y: PLACES.reedholm.y, zoom: 0.9 });
      yield* beat(1.5);
      yield* say(story, lynn, "晚了一步……不，还有人在喊。");
      yield* say(story, du, "阿温、小波！往渡口那边清路，让村民上船！");
      yield* say(story, wardens[0], "是！");
      yield* say(story, lynn, "我们去截那些点火的。一个都别放过。");
    });

    const rescue = stage.objective({ zh: "救出躲在屋里的村民，护送到渡口", en: "Get the hiding villagers to the ford" });
    const saved = new Set<string>();
    const lost = new Set<string>();
    let burned = 0;
    const refresh = () => rescue.progress(`${saved.size}/${total}`);
    refresh();
    const fordMark = stage.mark("place", PLACES.ford, { radius: 150, label: "渡口" });
    yield* ensure(fordMark.remove);

    // The villagers: they come out of a hut once wardens stand by it and no raider is near (and die inside if it burns
    // too long first); out, they run from whatever is close and make for the ford when nothing is.
    yield* every(seconds(0.5), function* villagersThink() {
      for (const entry of hiding) {
        if (entry.out) continue;
        const spot = HUT_SPOTS[entry.hut]!;
        // Where people still hide, a mark says so (the cries from inside).
        entry.mark ??= stage.mark("quest", { x: spot.x + 20, y: spot.y + 40 }, { radius: 50, label: "有人在屋里" });
        if (huts[entry.hut]!.state === "burning") {
          entry.burningSince ??= world.tick;
          if (world.tick - entry.burningSince > seconds(75)) {
            entry.out = true;
            entry.mark.remove();
            burned += entry.count;
            stage.float("……", spot, { color: "#8e2a1c", size: 22 });
            stage.notice({ zh: "一间着火的屋子塌了，里面的人没能出来", en: "A burning hut fell in with its people inside" }, "warn");
            continue;
          }
        }
        const wardensNear = world.units({ owner: PLAYER, within: { at: spot, radius: 280 } }).length > 0;
        const raidersNear = world.units({ owner: EMBER, within: { at: spot, radius: 360 } }).length > 0;
        if (!wardensNear || raidersNear) continue;
        entry.out = true;
        entry.mark.remove();
        for (let index = 0; index < entry.count; index += 1) {
          const villager = world.spawn(index % 2 ? CAST.villagerWoman : CAST.villager, FOLK, ring({ x: spot.x + 30, y: spot.y + 50 }, 30, index, entry.count));
          villagers.push(villager);
          stage.float("得救了！", villager, { color: "#3f6a3a" });
        }
        stage.bark(villagers[villagers.length - 1]!, world.pick(["守望者来了！", "快跑，去渡口！", "谢天谢地……"]), { span: seconds(2) });
      }
      for (const villager of villagers) {
        if (saved.has(villager.id) || lost.has(villager.id) || !world.alive(villager)) continue;
        if (REGIONS.ford.contains(villager)) {
          saved.add(villager.id);
          stage.float("上船了！", villager, { color: "#3f6a3a" });
          world.remove(villager);
          refresh();
          continue;
        }
        const threat = world.foesOf(villager, 240).sort((a, b) => distance(a, villager) - distance(b, villager))[0];
        if (threat) {
          const away = toward(villager, { x: villager.x * 2 - threat.x, y: villager.y * 2 - threat.y }, 220);
          world.move([villager], away);
        } else if (world.foesOf(villager, 420).length === 0 && villager.order.type === "idle") {
          world.move([villager], ring(PLACES.ford, 60, saved.size, 8));
        }
      }
    }, "villagers");
    yield* each("died", { unit: (unit) => villagers.some((villager) => villager.id === unit.id) }, function* mourn(event) {
      lost.add(event.unit.id);
      stage.float("……", event.unit, { color: "#8e2a1c" });
      if (lost.size === 1) stage.bark(lynn, "该死——快些！");
    });

    // The raider bands walk the village, burning as they go.
    const squads: Squad[] = [];
    for (const [index, band] of bands.entries()) {
      const route = [HUT_SPOTS[index * 3]!, HUT_SPOTS[index * 3 + 1]!, HUT_SPOTS[index * 3 + 2]!, PLACES.villageSquare];
      squads.push(yield* world.squad(EMBER, band, { kind: "patrol", route, leash: 320 }, { nerve: 0.4 }));
    }
    yield* every(seconds(1), function* burn() {
      for (const hutProp of huts) {
        if (hutProp.state) continue;
        const spot = HUT_SPOTS[huts.indexOf(hutProp)]!;
        const torch = world.units({ owner: EMBER, variant: CAST.ashRaider.id }).find((raider) => distance(raider, spot) < 90);
        if (!torch) continue;
        hutProp.state = "burning";
        stage.bark(torch, world.pick(["烧！", "一间不留！", "哈哈，烧得真旺！"]), { span: seconds(1.5) });
      }
    }, "arson");
    for (const band of squads) {
      const lead = band.alive()[0];
      if (lead) {
        const mark = stage.mark("target", lead, { radius: 40 });
        yield* ensure(mark.remove);
      }
    }

    // Tess calls for help once the fighting has started.
    const tessSaved = yield* spawn(function* tessBesieged(): Operation<void> {
      const siege = yield* world.squad(EMBER, besiegers, { kind: "hold", at: { x: PLACES.tessHut.x + 150, y: PLACES.tessHut.y + 110 }, leash: 260 }, { nerve: 0.2 });
      yield* wait(seconds(35));
      stage.bark(tess, "喂！那边穿绿斗篷的！能不能先来帮个忙！", { tone: "shout", span: seconds(3.5) });
      const help = stage.objective({ zh: "援救草药师的小屋", en: "Help the herbalist at her hut" });
      yield* marked(story, "quest", PLACES.tessHut, function* () {
        yield* until(() => siege.alive().length === 0);
      });
      help.done();
      siege.task.halt();
      tessThorns.halt();
      tessHut.state = undefined;
    }, "tess");

    // Kharn waits until his raiders are thinned, then comes for the wardens himself.
    yield* race({
      thinned: () => until(() => squads.reduce((count, band) => count + band.alive().length, 0) <= 3),
      tired: () => wait(seconds(200)),
    });
    aloof.halt();
    yield* cutscene(story, function* () {
      world.afflict(kharn, "guardian", seconds(20));
      world.move([kharn, ...guards], { x: PLACES.villageSquare.x, y: PLACES.villageSquare.y - 150 });
      yield* stage.framing({ mode: "follow", unitIds: [kharn.id], zoom: 1.25 });
      yield* beat(3);
      yield* say(story, kharn, "林族的狗！别再躲在农民后面了——出来！", { tone: "shout" });
      yield* say(story, kharn, "我是烙印者卡恩。记住这个名字，它会烙在你们的骨头上。");
      yield* say(story, du, "……灰原战帮的烙印。好久不见了。");
      for (const unit of [kharn, ...guards]) unit.effects = unit.effects.filter((effect) => effect.type !== "guardian");
    });
    const brand = stage.objective({ zh: "击败烙印者卡恩", en: "Defeat Kharn the Brand" });
    yield* empower(world, kharn, [cleave(), houndCall(3, 30)]);
    const warband = yield* world.squad(EMBER, [kharn, ...guards], { kind: "hunt", targetIds: Object.values(HERO_IDS) }, { nerve: 0.1 });
    const kharnMark = stage.mark("target", kharn, { radius: 50, label: "卡恩" });
    yield* ensure(kharnMark.remove);
    yield* spawn(function* kharnTaunts() {
      yield* until(() => !world.alive(kharn) || kharn.hp < kharn.maxHp * 0.5);
      if (world.alive(kharn)) stage.bark(kharn, "有意思……终于有人能让我流血了！", { tone: "shout" });
    });
    yield* until(() => !world.alive(kharn));
    brand.done();
    kharnMark.remove();
    warband.task.halt();
    reward(story, 80);
    yield* until(() => tessSaved.state !== "running" || tessSaved.outcome !== undefined);
    yield* wait(seconds(1));

    // The rest of the raiders flee once their captain falls.
    for (const raider of world.units({ owner: EMBER })) {
      stage.bark(raider, "卡恩死了！撤！", { span: seconds(1.5) });
      world.move([raider], { x: raider.x + 1600, y: raider.y - 900 });
    }
    yield* wait(seconds(3));
    sweep(story, [EMBER]);
    for (const band of squads) band.task.halt();
    // Whoever is still hiding comes out now the raiders are gone; the last of them reach the boat.
    for (const entry of hiding) if (!entry.out) entry.burningSince = undefined;
    yield* until(() => hiding.every((entry) => entry.out) && villagers.every((villager) => saved.has(villager.id) || lost.has(villager.id) || !world.alive(villager)));
    rescue.done();
    story.vars.villagersSaved = saved.size;
    story.vars.villagersLost = total - saved.size;
    reward(story, 20 * saved.size);

    // Tess joins, the ferrywoman gives Lynn her bowstring.
    yield* cutscene(story, function* () {
      yield* story.world.walk([lynn, du], { x: PLACES.tessHut.x + 120, y: PLACES.tessHut.y + 100 }, { limit: seconds(12) });
      yield* stage.framing({ mode: "follow", unitIds: [lynn.id, tess.id], zoom: 1.35 });
      yield* say(story, tess, "来得真慢。再晚一刻，我的荆棘就得开始吃人了。");
      yield* say(story, lynn, "你就是村里人说的那个……女巫？");
      yield* say(story, tess, "草药师。“女巫”是欠我药钱的人给我起的外号。");
      yield* say(story, du, "（低声）我欠过她钱。");
      yield* say(story, tess, "你们要追那些放火的？我跟着。反正我的房子，屋顶已经没了。");
      yield* say(story, lynn, "我们不缺会治伤的人……不，我们正缺。欢迎。");
    });
    tessAlone.stop();
    yield* bringHero(story, "tess");
    stage.notice("苔丝加入了队伍", "gain");

    // The last ferry crosses; the lost are buried by the reeds.
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: PLACES.ford.x + 250, y: PLACES.ford.y - 100, zoom: 1.2 });
      yield* say(story, mei, "最后一船了！坐稳，别乱动——这条河淹死过的人，比烬族烧死的多！", { tone: "shout" });
      const from = { x: PLACES.ford.x + 120, y: PLACES.ford.y - 20 };
      const to = { x: PLACES.ford.x + 520, y: PLACES.ford.y - 330 };
      for (let step = 0; step <= 160; step += 1) {
        const t = step / 160;
        boat.move({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 6) * 3 });
        if (step === 70) stage.float("对岸安全！", { x: to.x, y: to.y }, { color: "#3f6a3a", size: 18 });
        yield* wait(seconds(0.05));
      }
      yield* beat(1);
    });
    const graves = story.vars.villagersLost;
    if (graves > 0) {
      for (let index = 0; index < graves; index += 1) stage.prop("grave", { x: 4200 + (index % 4) * 55, y: 9020 + Math.floor(index / 4) * 50 });
      yield* cutscene(story, function* () {
        yield* story.world.walk([lynn, du, tess], { x: 4290, y: 8960 }, { limit: seconds(15) });
        yield* stage.framing({ mode: "point", x: 4290, y: 9020, zoom: 1.45 });
        yield* say(story, du, `${graves}个。天亮的时候，他们还在晒渔网。`);
        yield* say(story, tess, "我不会念悼词。……愿芦苇记得你们的名字。风吹过的时候，替你们说话。");
        yield* say(story, lynn, "我会记得。每一个。");
      });
    }

    yield* cutscene(story, function* () {
      yield* story.world.walk([lynn, du, tess], { x: PLACES.ford.x - 140, y: PLACES.ford.y + 60 }, { limit: seconds(20) });
      yield* stage.framing({ mode: "follow", unitIds: [lynn.id, mei.id], zoom: 1.35 });
      if (saved.size >= 6) yield* say(story, mei, "大多数人都过河了。守望者，芦苇渡欠你们一条命——很多条。");
      else if (saved.size >= 3) yield* say(story, mei, "过河的……只有这么些。可要不是你们，一个都过不去。");
      else yield* say(story, mei, "……船是空的。你们尽力了。我知道。");
      yield* say(story, mei, "我年轻时从老林子的心木上取过一根弓弦。这些年一直挂在墙上。墙烧了，弦还在。拿去。");
      award(story, "lynn", "heartwoodString");
      yield* say(story, lynn, "我会让它有用处。");
      yield* stage.framing({ mode: "follow", unitIds: [du.id], zoom: 1.35 });
      yield* say(story, du, "卡恩身上的烙印——三道火舌。那是灰原战帮的记号。瓦什卡的人。");
      yield* say(story, lynn, "瓦什卡？");
      yield* say(story, du, "……一个我以为二十年前就该被忘掉的名字。");
      yield* say(story, tess, "那就说明，有人没忘。");
      yield* stage.fadeTo(1, seconds(1.8));
    });
    huts.forEach((hut) => {
      if (hut.state === "burning") hut.state = "ruined";
    });
    sweep(story, [EMBER]);
    world.remove(mei);
  },
};

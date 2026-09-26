import type { Building, Unit } from "../../../shared/types";
import type { Chapter } from "../../../story/campaign";
import { ensure, race, spawn, type Operation } from "../../../story/kernel";
import { every, until, wait } from "../../../story/ops";
import { empower } from "../../../story/powers";
import { distance, ring } from "../../../story/region";
import { seconds } from "../../../story/time";
import { CAST } from "../cast";
import { army, award, beat, bringHero, cutscene, EMBER, FOLK, heroCare, marked, PLAYER, reward, say, sweep, type Vars } from "../common";
import { PLACES } from "../places";
import { eruption, fireRain, houndCall } from "../powers";
import { OUTPOST_SPOTS } from "./outpost";

// 第三章 · 焦土 - Into the ash wood. The Ember forward camp (forge, spire, towers, hall) must burn; its garrison holds
// with shield-guards and pyremancers whose fire falls where the wardens stand. Off the path, in a ruined hollow, the
// refugees Vashka drove ahead of him wait under guard, and Ig's sister among them. Oru the Pyremancer commands the camp
// and does not stay to die. At night, by the fire, Du tells them who Vashka is.

const CAMP = {
  forge: { x: 6380, y: 6480 },
  spire: { x: 6150, y: 6820 },
  hall: { x: 6560, y: 6800 },
  spire2: { x: 6780, y: 6560 },
  towers: [
    { x: 5850, y: 6500 },
    { x: 5880, y: 6860 },
    { x: 6250, y: 6260 },
    { x: 6700, y: 7060 },
  ],
} as const;
const LOOKOUT = { x: 5450, y: 6250 };

export const ashwood: Chapter<Vars> = {
  id: "ashwood",
  title: { zh: "第三章 · 焦土", en: "Chapter Three · Scorched Earth" },
  *play(story) {
    const { world, stage } = story;
    for (const spot of [[5200, 6400], [5500, 6700], [5000, 7000], [5700, 6300], [5300, 7300], [6000, 7200], [6800, 6200], [4900, 6200]]) stage.prop("deadTree", { x: spot[0]!, y: spot[1]! }, { scale: 1.3 });
    for (const spot of [[6250, 6300], [6700, 6550], [6450, 7000]]) stage.prop("tent", { x: spot[0]!, y: spot[1]! }, { scale: 1.2 });
    stage.prop("banner", { x: 6000, y: 6650 }, { state: "ember" });
    stage.prop("banner", { x: 6600, y: 6600 }, { state: "ember" });
    for (const spot of [[5150, 5750], [5300, 5950], [5400, 5700]]) stage.prop("ashPile", { x: spot[0]!, y: spot[1]! });

    const lynn = yield* bringHero(story, "lynn", { x: OUTPOST_SPOTS.front.x + 120, y: OUTPOST_SPOTS.front.y - 40 });
    const du = yield* bringHero(story, "du", { x: OUTPOST_SPOTS.front.x + 80, y: OUTPOST_SPOTS.front.y + 30 });
    const tess = yield* bringHero(story, "tess", { x: OUTPOST_SPOTS.front.x + 40, y: OUTPOST_SPOTS.front.y - 20 });
    const ig = story.vars.igFate === "joined" ? yield* bringHero(story, "ig", { x: OUTPOST_SPOTS.front.x + 160, y: OUTPOST_SPOTS.front.y + 40 }) : undefined;
    yield* heroCare(story, { rally: () => PLACES.outpost });
    world.gold(PLAYER, 300);

    // The Ember forward camp.
    const buildings: Building[] = [
      world.building("emberForge", EMBER, CAMP.forge),
      world.building("cinderSpire", EMBER, CAMP.spire),
      world.building("ashenHall", EMBER, CAMP.hall),
      world.building("cinderSpire", EMBER, CAMP.spire2),
      ...CAMP.towers.map((spot) => world.building("defenseTower", EMBER, spot)),
    ];
    const pyre = (unit: Unit) => empower(world, unit, [fireRain({ radius: 105, damage: 42, windUp: 1.6, least: 2 })]);
    const garrison = [
      ...world.spawnGroup(CAST.obsidianGuard, EMBER, { x: 5980, y: 6680 }, 5, { spread: 70 }),
      ...world.spawnGroup(CAST.ashRaider, EMBER, { x: 6150, y: 6600 }, 7, { spread: 90 }),
      ...world.spawnGroup(CAST.pyremancer, EMBER, { x: 6280, y: 6700 }, 3, { spread: 60 }),
    ];
    for (const unit of garrison) if (unit.variant === CAST.pyremancer.id) yield* pyre(unit);
    const patrolBand = [...world.spawnGroup(CAST.ashRaider, EMBER, { x: 5200, y: 6700 }, 3), ...world.spawnGroup(CAST.cinderHound, EMBER, { x: 5250, y: 6650 }, 3)];
    const oru = world.spawn(CAST.oru, EMBER, { x: 6420, y: 6680 }, { id: "oru" });

    // The hollow: refugees under guard, and Ashe.
    const refugees = world.spawnGroup(CAST.refugee, FOLK, PLACES.refugeeHollow, 5, { spread: 70 });
    const ashe = world.spawn(CAST.ashe, FOLK, { x: PLACES.refugeeHollow.x + 20, y: PLACES.refugeeHollow.y + 10 }, { id: "ashe" });
    const wardensOfHollow = [...world.spawnGroup(CAST.cinderHound, EMBER, { x: PLACES.refugeeHollow.x + 220, y: PLACES.refugeeHollow.y + 160 }, 4), ...world.spawnGroup(CAST.ashRaider, EMBER, { x: PLACES.refugeeHollow.x + 250, y: PLACES.refugeeHollow.y + 60 }, 2)];

    yield* stage.fadeTo(0, seconds(1.5));
    yield* stage.title("第三章 · 焦土", "Chapter Three · Scorched Earth");
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "follow", unitIds: [lynn.id, du.id], zoom: 1.2 });
      yield* say(story, du, "兵分两路？不。一起走。这片林子会吃掉落单的人。");
      yield* say(story, tess, "树都死了，可根还在。它们在疼。");
      if (ig) yield* say(story, ig, "营地在东边，靠着一口旧泉。守营的是欧鲁——他的火，是从天上掉下来的。看见地上发红，就跑。");
      yield* say(story, lynn, "听见了？地上发红就跑。其余的时候，往前压。");
    });

    // A look at the camp from the ridge before the assault.
    const lookout = stage.objective({ zh: "登上山脊，侦察烬族营地", en: "Climb the ridge and scout the camp" });
    yield* marked(story, "quest", LOOKOUT, function* () {
      yield* until(() => distance(lynn, LOOKOUT) < 260);
    });
    lookout.done();
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: 6300, y: 6650, zoom: 0.75 });
      yield* beat(1.5);
      if (ig) {
        yield* say(story, ig, "锻炉、两座尖塔、大厅，四座箭塔。欧鲁住在大厅后面，从不离开火堆超过十步。");
        yield* say(story, ig, "锻炉一倒，他们就会敲警钟。东边还有援兵。");
      } else {
        yield* say(story, tess, "锻炉、尖塔、大厅……还有塔。我数到四座。");
        yield* say(story, du, "营地搭得像个钉子。先拔塔，再拔营。");
      }
      yield* stage.framing({ mode: "follow", unitIds: [lynn.id, du.id], zoom: 1.25 });
      yield* say(story, du, "塔先交给我。我这面盾，挡箭比挡刀强。");
      yield* say(story, lynn, "弓手跟我，打那些扔火的。步兵跟杜伯。——走。");
    });

    const raze = stage.objective({ zh: "摧毁灰林中的烬族前进营地", en: "Destroy the Ember forward camp" });
    const refresh = () => raze.progress(`${buildings.filter((building) => world.game.buildings.includes(building)).length} 座建筑`);
    refresh();
    for (const building of buildings) {
      const mark = stage.mark("target", building, { radius: 70 });
      yield* ensure(mark.remove);
      yield* spawn(function* unmark() {
        yield* until(() => !world.game.buildings.includes(building));
        mark.remove();
        refresh();
      });
    }
    // The patrol walks the path to the camp; the garrison holds the camp; towers shoot what comes near.
    yield* world.squad(EMBER, patrolBand, { kind: "patrol", route: [{ x: 5200, y: 6700 }, { x: 4600, y: 6900 }, { x: 5300, y: 7100 }], leash: 420 }, { nerve: 0.6 });
    const holdCamp = yield* world.squad(EMBER, garrison, { kind: "hold", at: { x: 6150, y: 6680 }, leash: 520 }, { nerve: 0.3 });

    // The alarm: when the first building falls, the camp's bell calls in help from the east, three times.
    yield* spawn(function* alarm(): Operation<void> {
      yield* until(() => buildings.some((building) => !world.game.buildings.includes(building)));
      stage.notice({ zh: "烬族营地敲响了警钟！", en: "The Ember camp rings its alarm!" }, "warn");
      stage.quake(2, seconds(1));
      for (let wave = 0; wave < 3; wave += 1) {
        yield* wait(seconds(wave === 0 ? 8 : 28));
        const band = [...world.spawnGroup(CAST.ashRaider, EMBER, { x: 7400, y: 6700 }, 4, { spread: 80 }), ...world.spawnGroup(CAST.cinderHound, EMBER, { x: 7450, y: 6600 }, 3)];
        holdCamp.add(...band);
        world.attackMove(band, { x: 6300, y: 6650 });
      }
    }, "alarm");

    // Reinforcements keep coming from the camp for as long as the hall stands.
    yield* every(seconds(40), function* reinforce() {
      if (!world.game.buildings.includes(buildings[2]!)) return;
      const fresh = world.spawnGroup(CAST.ashRaider, EMBER, { x: CAMP.hall.x + 80, y: CAMP.hall.y + 60 }, 2);
      holdCamp.add(...fresh);
    }, "reinforce");

    // The side quest: the refugee hollow.
    const hollow = yield* spawn(function* refugeeHollow(): Operation<void> {
      yield* until(() => distance(lynn, PLACES.refugeeHollow) < 1100 || (ig !== undefined && distance(ig, PLACES.refugeeHollow) < 1100));
      if (ig) yield* say(story, ig, "那边——那是我们难民营地的破旗！艾舍会在那里！");
      else yield* say(story, tess, "那边有人在哭。是孩子。");
      const quest = stage.objective({ zh: "解救灰林洼地的难民", en: "Free the refugees in the hollow" }, { optional: true });
      const guards = yield* world.squad(EMBER, wardensOfHollow, { kind: "hold", at: PLACES.refugeeHollow, leash: 380 }, { nerve: 0.2 });
      yield* marked(story, "quest", PLACES.refugeeHollow, function* () {
        yield* until(() => guards.alive().length === 0);
      });
      guards.task.halt();
      quest.done();
      stage.settle("ashe", "done");
      story.vars.asheSaved = true;
      reward(story, 60);
      yield* cutscene(story, function* () {
        const party = [lynn, du, tess, ...(ig ? [ig] : [])];
        yield* story.world.walk(party, { x: PLACES.refugeeHollow.x - 80, y: PLACES.refugeeHollow.y + 60 }, { limit: seconds(12) });
        yield* stage.framing({ mode: "follow", unitIds: [ashe.id], zoom: 1.45 });
        if (ig) {
          world.move([ashe], ig);
          yield* beat(1.2);
          yield* say(story, ashe, "哥！你说你会回来的……你真的回来了！", { tone: "shout" });
          yield* say(story, ig, "我说过的话，这次算数。");
          yield* say(story, ashe, "他们说你是叛徒，说抓到你要把你扔进火里……");
          yield* say(story, ig, "我是叛徒。背叛了一个要烧掉世界的人。这个叛徒，我当得起。");
          yield* say(story, ashe, "（从脖子上摘下一枚铜片）这个给你。娘说它能挡火。");
          award(story, "ig", "ashesCharm");
          yield* say(story, ashe, "还有……草药师姐姐，娘教过我一个方子，治烧伤的。");
        } else {
          yield* say(story, ashe, "你们……不是来抓我们的？");
          yield* say(story, tess, "我们是来带你们走的。你哥哥呢？");
          yield* say(story, ashe, "我哥哥……叫伊格。他说他会回来的。");
          yield* say(story, lynn, "……", { tone: "think" });
          yield* say(story, ashe, "草药师姐姐，娘教过我一个方子，治烧伤的，送你。");
        }
        award(story, "tess", "emberSalve");
        yield* say(story, tess, "余烬、苔藓、还有……哦，原来是这样。谢谢你，小家伙。");
        yield* say(story, du, "带他们回前哨。沿着我们来的路走，路上的狗已经清干净了。");
      });
      for (const refugee of [...refugees, ashe]) world.move([refugee], ring(PLACES.outpost, 140, refugees.indexOf(refugee) + 1, 7));
    }, "hollow");

    // Oru comes out when his camp starts to fall, and does not stay to die.
    yield* until(() => buildings.filter((building) => world.game.buildings.includes(building)).length <= 3 || holdCamp.alive().length <= 3);
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "follow", unitIds: [oru.id], zoom: 1.3 });
      yield* say(story, oru, "林族的小虫子……你们来得正好。心木的火，正缺几根引柴。");
      yield* say(story, lynn, "你就是欧鲁？");
      yield* say(story, oru, "我是火的仆人。而你们——是火的食物。", { tone: "shout" });
    });
    const duel = stage.objective({ zh: "击退焚咒师欧鲁", en: "Drive off Oru the Pyremancer" });
    yield* empower(world, oru, [fireRain({ radius: 130, damage: 55, windUp: 1.5, least: 1, reach: 380 }), houndCall(2, 20)]);
    const oruSquad = yield* world.squad(EMBER, [oru], { kind: "hold", at: { x: 6300, y: 6650 }, leash: 600 }, { nerve: 0 });
    const oruMark = stage.mark("target", oru, { radius: 46, label: "欧鲁" });
    yield* ensure(oruMark.remove);
    yield* spawn(function* storm(): Operation<void> {
      yield* until(() => oru.hp < oru.maxHp * 0.6);
      stage.bark(oru, "天火，落下吧！", { tone: "shout" });
      yield* eruption(world, oru, centerOf(army(story)), 260, 6, 45);
    });
    yield* until(() => !world.alive(oru) || oru.hp < oru.maxHp * 0.3);
    oruSquad.task.halt();
    oruMark.remove();
    if (world.alive(oru)) {
      world.afflict(oru, "guardian", seconds(10));
      yield* cutscene(story, function* () {
        yield* stage.framing({ mode: "follow", unitIds: [oru.id], zoom: 1.35 });
        yield* say(story, oru, "……哼。营地你们拿去。反正，它只是一堆柴。", { tone: "whisper" });
        yield* say(story, oru, "瓦什卡大人会带着巨像来。到那时，你们会和老林子一起烧成灰！", { tone: "shout" });
        world.effect("summon", oru, seconds(1.5));
        world.effect("storm", oru, seconds(1.4), { radius: 90 });
        yield* beat(0.6);
        world.remove(oru);
        yield* say(story, du, "跑了。焚咒师的老把戏。");
      });
    }
    duel.done();
    reward(story, 80);

    yield* until(() => buildings.every((building) => !world.game.buildings.includes(building)));
    raze.done();
    reward(story, 100);
    holdCamp.task.halt();
    for (const unit of world.units({ owner: EMBER })) world.move([unit], { x: unit.x + 1500, y: unit.y - 500 });
    yield* race({ quiet: () => until(() => hollow.state !== "running"), late: () => wait(seconds(4)) });
    yield* wait(seconds(2));
    sweep(story, [EMBER]);
    hollow.halt();

    // The trophy tent: the Accord's shield.
    stage.prop("crate", { x: CAMP.forge.x - 80, y: CAMP.forge.y + 80 });
    const shieldSpot = { x: CAMP.forge.x - 60, y: CAMP.forge.y + 110 };
    const relic = stage.mark("relic", shieldSpot, { radius: 60 });
    yield* ensure(relic.remove);
    yield* cutscene(story, function* () {
      yield* story.world.walk([du, lynn], { x: shieldSpot.x - 40, y: shieldSpot.y + 30 }, { limit: seconds(15) });
      yield* stage.framing({ mode: "follow", unitIds: [du.id], zoom: 1.45 });
      yield* say(story, lynn, "战利品堆里有面盾……上面刻着字。");
      yield* say(story, du, "（拾起来）……盟约之盾。签盟约那天，两族各出一个匠人，一起铸的。");
      yield* say(story, du, "边上一圈名字，一半林族，一半烬族。他们把它当战利品。");
      yield* say(story, du, "那就让它回到该待的地方——挡在两族中间。");
      relic.remove();
      award(story, "du", "accordShield");
    });

    // Night, by the fire.
    yield* stage.fadeTo(1, seconds(1.5));
    const fire = { x: 5000, y: 6900 };
    const campfire = stage.prop("campfire", fire, { scale: 1.3 });
    yield* ensure(campfire.remove);
    world.place(du, { x: fire.x - 70, y: fire.y - 10 });
    world.place(lynn, { x: fire.x + 70, y: fire.y - 20 });
    world.place(tess, { x: fire.x + 10, y: fire.y + 70 });
    if (ig) world.place(ig, { x: fire.x - 30, y: fire.y + 80 });
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: fire.x, y: fire.y - 20, zoom: 1.6 });
      yield* stage.fadeTo(0.35, seconds(1.5));
      yield* stage.narrate("那天夜里，灰林的风停了。只有篝火在响。");
      yield* say(story, lynn, "杜伯。瓦什卡——你认识他。");
      yield* say(story, du, "……二十年前，盟约签订前的最后一仗。");
      yield* say(story, du, "我们打进一座烧塌的烬族村子。村口有个男孩，抱着他父亲的矛，冲我刺过来。");
      yield* say(story, du, "他才这么高。矛比他还长。我夺了矛，把他扛在肩上，一路送回了灰原的边界。");
      yield* say(story, du, "他一路上没哭，一直盯着我的脸。好像要把它记住。");
      yield* say(story, du, "那孩子的名字，叫瓦什卡。");
      yield* beat(1.5);
      yield* say(story, lynn, "你救过他。");
      yield* say(story, du, "我以为我救过他。");
      yield* say(story, tess, "有时候救下来的人，要花二十年，才决定自己要成为什么样的人。");
      if (ig) yield* say(story, ig, "他在营里说过一个林族老兵的事。他说，那是他见过最强的人——强到可以随手饶人一命。");
      if (ig) yield* say(story, ig, "他说，他这辈子，就想变得那么强。");
      yield* say(story, du, "……", { tone: "think" });
      yield* stage.fadeTo(1, seconds(2));
    });
  },
};

function centerOf(units: readonly Unit[]) {
  if (units.length === 0) return { x: 6000, y: 6700 };
  return { x: units.reduce((sum, unit) => sum + unit.x, 0) / units.length, y: units.reduce((sum, unit) => sum + unit.y, 0) / units.length };
}

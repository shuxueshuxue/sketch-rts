import type { Unit } from "../../../shared/types";
import type { Chapter } from "../../../story/campaign";
import { ensure, spawn, type Operation } from "../../../story/kernel";
import { subscribe, until, wait } from "../../../story/ops";
import { empower } from "../../../story/powers";
import { ring, type Point } from "../../../story/region";
import { seconds } from "../../../story/time";
import { CAST } from "../cast";
import { beat, bringHero, cutscene, EMBER, FOLK, hero, HERO_IDS, heroCare, marked, PLAYER, reward, say, sweep, type AshenStory, type Vars } from "../common";
import { PLACES } from "../places";
import { fireFlask, fireRain } from "../powers";

// 第二章 · 逃兵 - The wardens reopen the old outpost: a hall, a mine, workers, and the gold to raise a company. A lone Ember
// scout skulks at the wood's edge; caught, he turns out to be a deserter with a sister among the refugees Vashka drives
// ahead of his army, and a story about the Old Grove. What to do with him is the player's choice. Then the warband comes.

export const OUTPOST_SPOTS = {
  hall: PLACES.outpost,
  mine: PLACES.outpostMine,
  farms: [
    { x: 2820, y: 7250 },
    { x: 2900, y: 7330 },
  ],
  // Where the wardens put up more farms as the company grows.
  moreFarms: [
    { x: 2700, y: 7340 },
    { x: 2780, y: 7430 },
    { x: 2620, y: 7440 },
    { x: 2540, y: 7250 },
    { x: 2460, y: 7380 },
  ],
  barracks: { x: 3230, y: 6880 },
  range: { x: 3230, y: 7160 },
  towers: [
    { x: 3420, y: 6900 },
    { x: 3420, y: 7180 },
  ],
  front: { x: 3380, y: 7030 },
} as const;

export const outpost: Chapter<Vars> = {
  id: "outpost",
  title: { zh: "第二章 · 逃兵", en: "Chapter Two · The Deserter" },
  *play(story) {
    const { world, stage } = story;
    stage.clearProps(["tree", "reeds", "campfire", "crate", "ashPile", "grave", "cart", "fence", "watchtower"]);
    stage.prop("banner", { x: PLACES.outpost.x - 110, y: PLACES.outpost.y - 60 });
    stage.prop("campfire", { x: PLACES.outpost.x + 120, y: PLACES.outpost.y + 150 });
    for (const spot of [[2500, 7300], [2600, 6500], [3500, 6500], [2350, 6950]]) stage.prop("tree", { x: spot[0]!, y: spot[1]! }, { scale: 1.3 });
    for (const spot of [[4100, 6600], [4250, 6900], [4400, 6550], [4500, 6850], [4650, 6700]]) stage.prop("deadTree", { x: spot[0]!, y: spot[1]! }, { scale: 1.2 });

    const lynn = yield* bringHero(story, "lynn", { x: PLACES.outpost.x + 150, y: PLACES.outpost.y + 60 });
    const du = yield* bringHero(story, "du", { x: PLACES.outpost.x + 110, y: PLACES.outpost.y + 120 });
    const tess = yield* bringHero(story, "tess", { x: PLACES.outpost.x + 200, y: PLACES.outpost.y + 110 });
    const wardens = ["warden-wen", "warden-bo"].map((id) => world.unit(id)).filter((unit): unit is Unit => unit !== undefined);
    wardens.forEach((warden, index) => world.place(warden, ring({ x: PLACES.outpost.x + 170, y: PLACES.outpost.y + 90 }, 80, index, 2)));
    yield* heroCare(story, { rally: () => PLACES.outpost });

    // The outpost as the wardens find it: a hall still standing, a mine, and a handful of fen folk willing to work.
    world.building("townHall", PLAYER, OUTPOST_SPOTS.hall, { id: "outpost-hall" });
    for (const spot of OUTPOST_SPOTS.farms) world.building("farm", PLAYER, spot);
    world.game.resources.push({ id: "outpost-mine", kind: "goldMine", x: OUTPOST_SPOTS.mine.x, y: OUTPOST_SPOTS.mine.y, amount: 9000 });
    world.game.resources.push({ id: "outpost-mine-2", kind: "goldMine", x: 2600, y: 7550, amount: 6000 });
    const workers = world.spawnGroup("worker", PLAYER, { x: 2800, y: 6900 }, 5, { spread: 60 });
    world.gold(PLAYER, 520 - (world.game.players[PLAYER]?.gold ?? 0));
    world.order(workers, (unitIds) => ({ type: "mine", unitIds, resourceId: "outpost-mine" }));

    yield* stage.fadeTo(0, seconds(1.5));
    yield* stage.title("第二章 · 逃兵", "Chapter Two · The Deserter");
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: PLACES.outpost.x + 100, y: PLACES.outpost.y + 50, zoom: 1.15 });
      yield* say(story, du, "老前哨。二十年没人住了，墙倒还结实。");
      yield* say(story, lynn, "守望塔的援兵最快也要三天。三天里，那些放火的能再烧三个村子。");
      yield* say(story, tess, "那就别等援兵。渡口来的人里，有一半会用锄头，剩下一半会用斧头。");
      yield* say(story, du, "锄头和斧头都能换成矛。——开矿，建营房。我来教他们站队列。");
    });

    const rebuild = stage.objective({ zh: "重建前哨：建造兵营，训练 6 名士兵", en: "Rebuild the outpost: a barracks and six soldiers" });
    const recruits = new Set<string>();
    const trained = yield* subscribe("arrived", { unit: (unit) => unit.owner === PLAYER && (unit.kind === "footman" || unit.kind === "archer" || unit.kind === "lancer") });
    rebuild.progress("0/6");
    yield* spawn(function* countRecruits() {
      for (;;) {
        const event = yield* trained.next();
        recruits.add(event.unit.id);
        rebuild.progress(`${Math.min(6, recruits.size)}/6`);
        if (recruits.size === 1) stage.bark(du, "腰挺直！矛尖朝前，不是朝你自己的脚！");
        if (recruits.size === 4) stage.bark(wardens[0] ?? du, "他们学得比我当年快。");
      }
    });
    yield* spawn(function* camp(): Operation<void> {
      yield* wait(seconds(25));
      yield* say(story, tess, "这片地的土很怪。草根下面全是灰——不是烧的，是从北边吹过来的。");
      yield* say(story, du, "灰原在往南长。每年多一指宽。");
    });
    yield* until(() => recruits.size >= 6 && world.buildings(PLAYER, "barracks").some((barracks) => barracks.complete));
    rebuild.done();
    reward(story, 60);

    // ---- The scout at the wood's edge.
    const bo = world.unit("warden-bo");
    yield* cutscene(story, function* () {
      if (bo) yield* say(story, bo, "队长！林子边上有个烬族人在转悠，一个人，鬼鬼祟祟的。");
      yield* say(story, lynn, "一个人？斥候不会一个人走这么近。");
      yield* say(story, du, "除非他不是斥候。抓活的。");
    });
    const ig = world.spawn(CAST.ig, EMBER, PLACES.woodEdge, { id: HERO_IDS.ig });
    stage.cast(ig, { name: { zh: "烬族斥候", en: "Ember scout" }, color: "#8e2a1c" });
    const catchIg = stage.objective({ zh: "抓住烬族斥候（活捉）", en: "Catch the Ember scout alive" });
    const igMark = stage.mark("target", ig, { radius: 36, label: "活捉" });
    yield* ensure(igMark.remove);
    yield* marked(story, "quest", PLACES.woodEdge, function* () {
      yield* until(() => world.distance(lynn, ig) < 520 || world.distance(du, ig) < 520);
    });
    stage.bark(ig, "……被发现了。", { tone: "whisper" });
    world.move([ig], { x: ig.x + 500, y: ig.y - 300 });
    yield* wait(seconds(2.5));
    // Tess's thorns catch him before he reaches the trees.
    yield* say(story, tess, "跑？在我的地盘上？", { tone: "shout", span: seconds(1.6) });
    const snare = stage.mark("snare", ig, { radius: 30 });
    const pace = ig.speed;
    ig.speed = 0;
    yield* wait(seconds(1.5));
    snare.remove();
    ig.speed = pace;
    const scrapping = yield* empower(world, ig, [fireFlask(() => 2)]);
    yield* world.squad(EMBER, [ig], { kind: "hunt", targetIds: [lynn.id, du.id, tess.id] }, { nerve: 0 });
    // Nobody here wants him dead: at half his strength he throws down his knives, and the blows stop.
    yield* until(() => ig.hp < ig.maxHp * 0.5);
    world.afflict(ig, "guardian", seconds(3));
    scrapping.stop();
    ig.owner = FOLK;
    ig.order = { type: "idle" };
    for (const unit of world.units({ owner: PLAYER })) if ((unit.order as { targetId?: string }).targetId === ig.id) unit.order = { type: "idle" };
    catchIg.done();
    igMark.remove();
    reward(story, 50);

    yield* cutscene(story, function* () {
      yield* story.world.walk([lynn, du, tess], ring(ig, 90, 0, 3), { limit: seconds(10) });
      yield* stage.framing({ mode: "follow", unitIds: [ig.id, lynn.id], zoom: 1.4 });
      yield* say(story, ig, "要杀就快点。反正回去也是死。");
      yield* say(story, lynn, "你一个人在林子边上转了一上午。斥候不会这么蠢。");
      yield* say(story, ig, "……我是逃兵。叫我伊格就行。");
      stage.cast(ig, { name: CAST.ig.name, color: CAST.ig.color });
      yield* say(story, du, "逃什么？");
      yield* say(story, ig, "逃瓦什卡。他说，只要烧了你们的老林子，心木的火就能把圣火重新点着。");
      yield* say(story, ig, "一棵树，换一整个民族。多划算的买卖，对吧？");
      yield* say(story, tess, "心木烧了，沼泽会干，芦苇会死，你们的灰原会一直烧到海边。那不叫点火，那叫把整个世界当柴。");
      yield* say(story, ig, "我知道。所以我跑了。");
      yield* say(story, ig, "我妹妹还在后面……在难民里。瓦什卡让难民走在军队前面，替他踩陷阱、吃箭。");
      yield* say(story, du, "（沉默良久）……二十年前，我也见过这一招。");
    });

    const fate = yield* stage.choose(
      "伊格跪在灰里，等着你的决定。杜伯和苔丝都看着你。",
      [
        { id: "spare", text: "放了他，让他带路——他知道瓦什卡的营地在哪。" },
        { id: "trial", text: "押回守望塔，交给议会审判。" },
        { id: "execute", text: "就地处决。他是敌人的兵。" },
      ],
      { id: "ig", speaker: lynn },
    );
    story.vars.choices.ig = fate;
    if (fate === "spare") {
      story.vars.igFate = "joined";
      yield* cutscene(story, function* () {
        yield* say(story, lynn, "起来。你带路。你妹妹，我们一起去找。");
        yield* say(story, ig, "……你认真的？");
        yield* say(story, du, "我不反对。这世上多一个回头的人，就少一个放火的人。");
        yield* say(story, tess, "要是他骗我们，我第一个把他种进泥里当肥料。");
        yield* say(story, ig, "……谢谢。我不会让你们后悔。");
      });
      yield* bringHero(story, "ig");
      stage.notice("伊格加入了队伍", "gain");
      stage.objective({ zh: "寻找伊格的妹妹艾舍", en: "Find Ig's sister Ashe" }, { optional: true, key: "ashe" });
    } else if (fate === "trial") {
      story.vars.igFate = "trial";
      yield* cutscene(story, function* () {
        yield* say(story, lynn, "你会被押回守望塔。议会怎么判，是议会的事。");
        yield* say(story, ig, "议会……好。至少是个公道的死法。");
        yield* say(story, du, "他不会死。议会里有我的老朋友。——大概。");
        if (bo) yield* say(story, bo, "我押他回去。");
      });
      if (bo) world.move([bo], PLACES.fenwatch);
      world.remove(ig);
    } else {
      story.vars.igFate = "executed";
      yield* cutscene(story, function* () {
        yield* say(story, du, "林恩。你父亲不会这么做。");
        yield* say(story, lynn, "我父亲死在上一场战争里，杜伯。");
        yield* say(story, ig, "……告诉艾舍，哥哥没能回去。");
        world.strike(lynn, ig, 9999, "ranged");
        yield* beat(2);
        yield* say(story, tess, "……", { tone: "think" });
      });
    }

    // ---- The warband comes for the outpost.
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: PLACES.woodEdge.x + 200, y: PLACES.woodEdge.y, zoom: 0.9 });
      yield* beat(1.2);
      if (fate === "spare") yield* say(story, hero(story, "ig"), "是战帮的先锋！他们一定是跟着我的脚印来的。");
      else yield* say(story, tess, "林子里全是火光。他们来了。");
      yield* say(story, lynn, "所有人，回前哨！守住营房！", { tone: "shout" });
    });
    const hold = stage.objective({ zh: "守住前哨", en: "Hold the outpost" });
    const rallyMark = stage.mark("rally", OUTPOST_SPOTS.front, { radius: 170, label: "守住这里" });
    yield* ensure(rallyMark.remove);
    const started = world.tick;
    const length = seconds(150);
    yield* spawn(function* clock() {
      for (;;) {
        hold.progress(`${Math.max(0, Math.ceil((started + length - world.tick) / 20))}s`);
        yield* wait(seconds(1));
      }
    });
    const waves: [number, () => Unit[]][] = [
      [3, () => [...world.spawnGroup(CAST.ashRaider, EMBER, { x: 4700, y: 6800 }, 5), ...world.spawnGroup(CAST.cinderHound, EMBER, { x: 4750, y: 7050 }, 3)]],
      [45, () => [...world.spawnGroup(CAST.ashRaider, EMBER, { x: 4700, y: 6600 }, 4), ...world.spawnGroup(CAST.pyremancer, EMBER, { x: 4850, y: 6700 }, 1), ...world.spawnGroup(CAST.cinderHound, EMBER, { x: 4700, y: 7200 }, 4)]],
      [95, () => [...world.spawnGroup(CAST.ashRaider, EMBER, { x: 4700, y: 7000 }, 6), ...world.spawnGroup(CAST.obsidianGuard, EMBER, { x: 4800, y: 6900 }, 2), ...world.spawnGroup(CAST.pyremancer, EMBER, { x: 4900, y: 6800 }, 2)]],
    ];
    for (const [at, bring] of waves) {
      yield* spawn(function* wave(): Operation<void> {
        yield* wait(seconds(at));
        const band = bring();
        for (const unit of band) if (unit.variant === CAST.pyremancer.id) yield* empower(world, unit, [fireRain({ radius: 100, damage: 40, windUp: 1.6, least: 2 })]);
        stage.notice({ zh: "烬族来袭！", en: "The Ember attack!" }, "warn");
        const squad = yield* world.squad(EMBER, band, { kind: "attack", at: OUTPOST_SPOTS.hall }, { nerve: 0.5 });
        yield* squad.defeated();
      }, "wave");
    }
    yield* until(() => world.tick >= started + length && world.units({ owner: EMBER }).filter((unit) => unit.x < 4600).length === 0);
    hold.done();
    reward(story, 90);
    for (const raider of world.units({ owner: EMBER })) world.move([raider], { x: raider.x + 1500, y: raider.y });
    yield* wait(seconds(2));
    sweep(story, [EMBER]);

    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "follow", unitIds: [lynn.id, du.id], zoom: 1.3 });
      yield* say(story, du, "他们退了。可那不是溃退——是试完了水深，回去报信。");
      const guide = hero(story, "ig");
      if (guide) {
        yield* say(story, guide, "这些只是先锋。真正的营地在灰林深处，有个叫欧鲁的焚咒师在那里守着。");
        yield* say(story, guide, "难民……也在那附近。");
      } else {
        yield* say(story, tess, "他们从东边的灰林里来的。营地一定就在林子深处。");
      }
      yield* say(story, lynn, "那我们就去灰林。在他们回来之前。");
      yield* stage.fadeTo(1, seconds(1.8));
    });
  },
};

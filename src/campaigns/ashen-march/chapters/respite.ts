import type { Unit } from "../../../shared/types";
import type { Chapter } from "../../../story/campaign";
import { all, ensure, type Operation } from "../../../story/kernel";
import { until } from "../../../story/ops";
import { ring, type Point } from "../../../story/region";
import { seconds } from "../../../story/time";
import { CAST } from "../cast";
import { award, bringHero, cutscene, FOLK, hero, heroCare, heroes, marked, reward, say, WILD, type AshenStory, type Vars } from "../common";
import { PLACES } from "../places";
import { OUTPOST_SPOTS } from "./outpost";

// 幕间 · 篝火之后 - Two quiet days at the outpost, now a refugee camp. Three things want doing at once, in whatever order
// the wardens take them (three branches of one `all`): an old man of Reedholm who lost his son wants a word; Bo asks
// someone to light the fen beacon so the watchtower sends riders (and wolves have denned by it); Tess needs three
// moonpetal herbs from the wood's edge. A lit beacon brings the Grove's riders to the last battle.

const BAO: Point = { x: 2860, y: 7280 };
const BEACON: Point = { x: 2050, y: 7700 };
const HERBS: Point[] = [
  { x: 2350, y: 6480 },
  { x: 3520, y: 6380 },
  { x: 3850, y: 7250 },
];

export const respite: Chapter<Vars> = {
  id: "respite",
  title: { zh: "幕间 · 篝火之后", en: "Interlude · After the Fire" },
  *play(story) {
    const { world, stage } = story;
    stage.clearProps(["tent", "banner", "deadTree", "ashPile", "crate", "campfire"]);
    for (const spot of [[2700, 7150], [2780, 7420], [3150, 7350], [2600, 6950]]) stage.prop("tent", { x: spot[0]!, y: spot[1]! }, { scale: 1.1 });
    stage.prop("campfire", { x: 2900, y: 7200 }, { scale: 1.2 });
    stage.prop("campfire", { x: 3100, y: 7450 });
    const beacon = stage.prop("beacon", BEACON, { scale: 1.3 });
    for (const spot of [[1900, 7500], [2200, 7850], [1800, 7800]]) stage.prop("reeds", { x: spot[0]!, y: spot[1]! }, { scale: 1.3 });

    const at = { x: OUTPOST_SPOTS.front.x - 120, y: OUTPOST_SPOTS.front.y + 100 };
    const lynn = yield* bringHero(story, "lynn", at);
    const du = yield* bringHero(story, "du", ring(at, 70, 1, 4));
    const tess = yield* bringHero(story, "tess", ring(at, 70, 2, 4));
    const ig = story.vars.igFate === "joined" ? yield* bringHero(story, "ig", ring(at, 70, 3, 4)) : undefined;
    yield* heroCare(story, { rally: () => at });
    const bao = world.spawn(CAST.villager, FOLK, BAO);
    stage.cast(bao, { name: "老鲍", color: "#8a6a3a" });
    const camp = [...world.spawnGroup(CAST.refugee, FOLK, { x: 2750, y: 7300 }, story.vars.asheSaved ? 4 : 2, { spread: 80 }), ...world.spawnGroup(CAST.villagerWoman, FOLK, { x: 3050, y: 7400 }, 3, { spread: 70 })];
    const ashe = story.vars.asheSaved ? world.spawn(CAST.ashe, FOLK, { x: 2950, y: 7250 }, { id: "ashe" }) : undefined;
    yield* ensure(() => {
      for (const unit of [...camp, bao, ...(ashe ? [ashe] : [])]) world.remove(unit);
    });

    yield* stage.fadeTo(0, seconds(1.5));
    yield* stage.narrate("灰林的火熄了两天。前哨成了难民的营地：林族的，烬族的，挤在同一堆篝火旁。");
    yield* stage.title("幕间 · 篝火之后", "Interlude · After the Fire");
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: 2950, y: 7280, zoom: 1.3 });
      if (ashe) yield* say(story, ashe, "那个林族的婆婆给了我一块饼。她说我吃饭的样子像她孙女。");
      yield* say(story, du, "两天前他们还在互相扔石头。饿了两天，就开始分饼了。");
      yield* say(story, tess, "饿和冷，比盟约管用。");
      yield* say(story, lynn, "趁还有时间，把该做的事做完。瓦什卡不会等我们太久。");
    });

    // Three errands at once; the wardens take them in whatever order they come to them.
    yield* all({
      bao: () => oldBao(story, bao),
      beacon: () => fenBeacon(story, beacon),
      herbs: () => moonpetals(story),
    });

    // News from the pass.
    const scout = world.spawn(CAST.warden, FOLK, { x: PLACES.woodEdge.x, y: PLACES.woodEdge.y - 400 });
    stage.cast(scout, { name: "斥候", color: "#4f7a6e" });
    world.move([scout], lynn);
    yield* until(() => world.distance(scout, hero(story, "lynn") ?? lynn) < 150 || !world.alive(scout));
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "follow", unitIds: [scout.id, lynn.id], zoom: 1.35 });
      yield* say(story, scout, "报——烬族大军动了！往北，往山口去了！前面……前面还有逃难的人！", { tone: "shout" });
      yield* say(story, lynn, "山口后面，就是老林子。");
      yield* say(story, du, "他要绕过我们，直取心木。");
      if (ig) yield* say(story, ig, "逃难的人……是被赶在前面探路的。又是这一招。");
      yield* say(story, lynn, "收拾东西。天黑前，我们要到山口。");
      yield* stage.fadeTo(1, seconds(1.8));
    });
    world.remove(scout);
  },
};

// An old Reedholm man who lost his son in the raid: he wants to know how the boy died.
function* oldBao(story: AshenStory, bao: Unit): Operation<void> {
  const { stage, world } = story;
  const lynn = hero(story, "lynn")!;
  const talk = stage.objective({ zh: "和老鲍说说话", en: "Talk to Old Bao" }, { optional: true });
  yield* marked(story, "quest", bao, function* () {
    yield* until(() => world.distance(hero(story, "lynn") ?? lynn, bao) < 150);
  }, "老鲍");
  yield* cutscene(story, function* () {
    yield* stage.framing({ mode: "follow", unitIds: [bao.id, lynn.id], zoom: 1.5 });
    yield* say(story, bao, "守望者……你那天在芦苇渡。你看见我家阿木了吗？渡口边上，穿蓝褂子的。");
    yield* say(story, lynn, "……", { tone: "think" });
    const answer = yield* stage.choose(
      "你记得那件蓝褂子。你赶到的时候，屋顶已经塌了。",
      [
        { id: "comfort", text: "“他走得很快，没受苦。”" },
        { id: "truth", text: "“我们来晚了。对不起。”" },
      ],
      { id: "bao", speaker: lynn },
    );
    story.vars.choices.bao = answer;
    if (answer === "comfort") {
      yield* say(story, bao, "没受苦……那就好，那就好。");
      yield* say(story, bao, "他从小就怕疼。");
      yield* say(story, lynn, "……", { tone: "think" });
    } else {
      yield* say(story, bao, "……来晚了。");
      yield* say(story, bao, "可你们来了。那天好多人没等到任何人来。");
      yield* say(story, bao, "去吧，守望者。别让别的村子也等不到。");
    }
  });
  talk.done();
  reward(story, 40);
}

// Bo asks for the fen beacon to be lit; wolves have denned beside it.
function* fenBeacon(story: AshenStory, beacon: { state: string | undefined }): Operation<void> {
  const { stage, world } = story;
  const bo = world.unit("warden-bo");
  if (bo) stage.bark(bo, "队长！沼泽边的烽火台，得有人去点上。守望塔看见烟，就会派骑手来。");
  const quest = stage.objective({ zh: "点燃沼泽烽火台，召来守望塔的骑手", en: "Light the fen beacon to call the watch's riders" }, { optional: true });
  yield* marked(story, "quest", BEACON, function* () {
    yield* until(() => heroes(story).some((unit) => world.distance(unit, BEACON) < 520));
  }, "烽火台");
  const pack = [...world.spawnGroup(CAST.fenWolf, WILD, { x: BEACON.x - 250, y: BEACON.y + 120 }, 6, { spread: 90 }), world.spawn(CAST.fenWolfAlpha, WILD, { x: BEACON.x - 200, y: BEACON.y + 200 })];
  stage.bark(pack[pack.length - 1]!, "嗷——", { tone: "shout", span: seconds(1.5) });
  const den = yield* world.squad(WILD, pack, { kind: "hold", at: BEACON, leash: 500 }, { nerve: 0.2 });
  yield* marked(story, "target", BEACON, function* () {
    yield* den.defeated();
  });
  yield* marked(story, "quest", BEACON, function* () {
    yield* until(() => heroes(story).some((unit) => world.distance(unit, BEACON) < 140));
  }, "点燃");
  beacon.state = "lit";
  story.vars.beaconLit = true;
  stage.quake(1, seconds(0.5));
  stage.notice({ zh: "烽火点燃了——守望塔的骑手会赶来", en: "The beacon burns: the watch's riders will come" }, "gain");
  const lighter = heroes(story).sort((a, b) => world.distance(a, BEACON) - world.distance(b, BEACON))[0];
  if (lighter) yield* say(story, lighter, "烟起来了。希望塔上的人没睡着。");
  quest.done();
  reward(story, 70);
}

// Tess needs three moonpetal herbs from the edge of the wood.
function* moonpetals(story: AshenStory): Operation<void> {
  const { stage, world } = story;
  const tess = hero(story, "tess");
  if (tess) stage.bark(tess, "林子边上长着月瓣草。采三株来，我给大家配点好东西。");
  const quest = stage.objective({ zh: "采集月瓣草（给苔丝）", en: "Gather moonpetal herbs for Tess" }, { optional: true });
  let gathered = 0;
  quest.progress("0/3");
  yield* all(Object.fromEntries(HERBS.map((spot, index) => [`herb${index}`, function* herb(): Operation<void> {
    const glow = stage.mark("relic", spot, { radius: 50 });
    yield* ensure(glow.remove);
    yield* marked(story, "quest", spot, function* () {
      yield* until(() => heroes(story).some((unit) => world.distance(unit, spot) < 90));
    }, "月瓣草");
    glow.remove();
    gathered += 1;
    quest.progress(`${gathered}/3`);
    stage.float("+月瓣草", spot, { color: "#5d7a3a", size: 16 });
  }])));
  quest.done();
  const herbalist = hero(story, "tess");
  if (herbalist) {
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "follow", unitIds: [herbalist.id], zoom: 1.5 });
      yield* say(story, herbalist, "月瓣、苔藓、还有一点余烬药膏……好了。");
      yield* say(story, herbalist, "一个小药囊。受伤的时候闻一闻，能多撑一会儿。");
    });
    award(story, "tess", "moonpetalSatchel");
  }
  reward(story, 50);
}

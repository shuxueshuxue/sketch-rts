import type { Unit } from "../../../shared/types";
import type { Chapter } from "../../../story/campaign";
import { race, spawn, type Operation } from "../../../story/kernel";
import { until, wait } from "../../../story/ops";
import { distance, ring } from "../../../story/region";
import { seconds } from "../../../story/time";
import { CAST } from "../cast";
import { beat, bringHero, cutscene, EMBER, heroCare, marked, PLAYER, reward, say, sweep, WILD, type AshenStory, type Vars } from "../common";
import { PLACES } from "../places";
import { villageScenery } from "./reedholm";

const NORTH_BEACON = { x: 2500, y: 9050 };

// 序章 · 雾中巡逻 - A patrol along the border stones on a quiet morning; wolves driven down to the river by something;
// a burned supply cart with an Ember arrow in the driver; the first choice; smoke over Reedholm.

export const prologue: Chapter<Vars> = {
  id: "prologue",
  title: { zh: "序章 · 雾中巡逻", en: "Prologue · Patrol in the Mist" },
  *play(story) {
    const { world, stage } = story;
    yield* stage.fadeTo(1, seconds(0));
    stage.prop("watchtower", { x: PLACES.fenwatch.x - 140, y: PLACES.fenwatch.y - 60 }, { scale: 1.3 });
    for (const [index, spot] of [[1100, 10150], [1700, 10420], [2450, 9550], [3050, 10500], [3250, 10640], [3400, 10560], [2950, 10620]].entries()) stage.prop("reeds", { x: spot[0]!, y: spot[1]! }, { scale: 1.2 + (index % 2) * 0.3 });
    for (const spot of [[1300, 9950], [1850, 10500], [2300, 10450], [3900, 10300]]) stage.prop("tree", { x: spot[0]!, y: spot[1]! }, { scale: 1.3 });
    stage.prop("fence", { x: PLACES.fenwatch.x + 40, y: PLACES.fenwatch.y + 90 });
    stage.prop("campfire", { x: PLACES.fenwatch.x + 90, y: PLACES.fenwatch.y - 20 }, { state: "out" });
    const butt = { x: PLACES.fenwatch.x + 330, y: PLACES.fenwatch.y - 30 };
    stage.prop("target", butt, { scale: 1.1 });
    const beacon = stage.prop("beacon", NORTH_BEACON, { scale: 1.3 });

    const lynn = yield* bringHero(story, "lynn", { x: PLACES.fenwatch.x + 60, y: PLACES.fenwatch.y + 10 });
    const du = yield* bringHero(story, "du", { x: PLACES.fenwatch.x + 10, y: PLACES.fenwatch.y + 50 });
    const wen = world.spawn(CAST.warden, PLAYER, { x: PLACES.fenwatch.x - 30, y: PLACES.fenwatch.y + 20 }, { id: "warden-wen" });
    const bo = world.spawn(CAST.warden, PLAYER, { x: PLACES.fenwatch.x + 110, y: PLACES.fenwatch.y + 70 }, { id: "warden-bo" });
    stage.cast(wen, { name: "阿温", color: "#4f7a6e" });
    stage.cast(bo, { name: "小波", color: "#4f7a6e" });
    yield* heroCare(story, { downtime: seconds(18) });
    stage.look({ mode: "follow", unitIds: [lynn.id, du.id], zoom: 1.15 });

    // ---- Opening words over black.
    yield* stage.narrate("灰烬盟约签订的第二十年。芦苇沼泽依旧潮湿、安静。");
    yield* stage.narrate("界碑一线以南，是林族的沼泽；以北，是烬族的灰原。");
    yield* stage.narrate("守望塔的老人们说：太安静的沼泽，比着火的沼泽更吓人。");
    yield* spawn(function* dawn() {
      yield* stage.fadeTo(0, seconds(2.5));
    });
    yield* stage.title("序章 · 雾中巡逻", "Prologue · Patrol in the Mist");

    // Morning practice at the butts: three arrows, and the wardens' talk.
    yield* cutscene(story, function* () {
      yield* stage.framing({ mode: "point", x: PLACES.fenwatch.x + 170, y: PLACES.fenwatch.y, zoom: 1.35 });
      for (const [index, line] of ["第一箭。", "第二箭。", ""].entries()) {
        world.effect("projectile", butt, seconds(0.5), { fromX: lynn.x, fromY: lynn.y - 20, toX: butt.x + (index - 1) * 3, toY: butt.y - 18, sourceKind: "archer" });
        yield* beat(0.55);
        world.effect("hit", { x: butt.x, y: butt.y - 18 }, seconds(0.5));
        if (line) stage.bark(wen, line, { span: seconds(1) });
        yield* beat(0.8);
      }
      yield* say(story, wen, "三箭都在红心里……队长，你这手是跟谁学的？");
      yield* say(story, du, "跟我。");
      yield* say(story, lynn, "跟我父亲。杜伯只教会了我怎么在射偏的时候骂人。");
      yield* say(story, du, "那也是一门手艺。");
      yield* say(story, du, "雾这么大，狼都懒得出门。");
      yield* say(story, lynn, "狼不出门，人会。三块界碑，天黑前查完。");
      yield* say(story, bo, "队长，听说烬族那边今年的圣火快熄了？");
      yield* say(story, du, "圣火熄不熄，是他们的事。咱们的事，是界碑别被人挪了。");
      yield* say(story, lynn, "……也别被人烧了。走吧。");
      yield* say(story, wen, "（小声）我还是觉得今天不对劲。");
    });
    stage.look({ mode: "auto", zoom: 1.05 });

    const stones = stage.objective({ zh: "巡查三块界碑", en: "Inspect the three border stones" });
    stones.progress("0/3");
    yield* spawn(function* banter() {
      yield* wait(seconds(6));
      stage.bark(du, "我这膝盖比风向标还准。今晚要下雨。");
      yield* wait(seconds(5));
      stage.bark(bo, "杜伯，您上回说要下雨，结果下了三天冰雹。");
      yield* wait(seconds(4));
      stage.bark(du, "那也是水。");
    });

    // ---- The first stone.
    yield* marked(story, "quest", PLACES.stones[0], function* () {
      yield* until(() => world.distance(lynn, PLACES.stones[0]) < 150);
    });
    yield* cutscene(story, function* () {
      yield* say(story, lynn, "第一块，完好。……有人在上面系了根红绳。");
      yield* say(story, du, "烬族的祈福结。去年秋天从北边刮过来的，挂哪儿算哪儿。");
      yield* say(story, lynn, "今年秋天还没到。");
    });
    stones.progress("1/3");
    reward(story, 25);

    // ---- Smoke on the northern hills.
    yield* beat(4);
    yield* cutscene(story, function* () {
      beacon.state = "lit";
      yield* stage.framing({ mode: "point", x: NORTH_BEACON.x, y: NORTH_BEACON.y + 60, zoom: 1.1 });
      yield* beat(1.6);
      yield* say(story, bo, "北边山上……那是烟吗？");
      yield* stage.framing({ mode: "follow", unitIds: [du.id, lynn.id], zoom: 1.3 });
      yield* say(story, du, "灰原的烽火台。三年没点过了。");
      yield* say(story, lynn, "烽火是报给谁的？");
      yield* say(story, du, "报给后面的人：路已经探好了。");
    });

    // ---- The second stone, and the wolves driven down from the reeds.
    yield* marked(story, "quest", PLACES.stones[1], function* () {
      yield* until(() => world.distance(lynn, PLACES.stones[1]) < 420);
    });
    yield* wolves(story, [lynn, du, wen, bo]);
    yield* marked(story, "quest", PLACES.stones[1], function* () {
      yield* until(() => world.distance(lynn, PLACES.stones[1]) < 160);
    });
    yield* cutscene(story, function* () {
      yield* say(story, lynn, "第二块也在。");
      yield* say(story, du, "狼不该这个时节下到河边……它们在躲什么东西。");
      yield* say(story, wen, "躲、躲什么？");
      yield* say(story, du, "比狼更饿的东西。");
    });
    stones.progress("2/3");
    reward(story, 25);

    // ---- The third stone: the burned cart.
    stage.prop("cart", PLACES.burnedCart, { state: "ruined", scale: 1.2 });
    stage.prop("ashPile", { x: PLACES.burnedCart.x + 60, y: PLACES.burnedCart.y + 40 });
    stage.prop("grave", { x: PLACES.burnedCart.x - 70, y: PLACES.burnedCart.y + 30 });
    yield* marked(story, "quest", PLACES.stones[2], function* () {
      yield* until(() => world.distance(lynn, PLACES.stones[2]) < 200);
    });
    yield* cutscene(story, function* () {
      yield* story.stage.framing({ mode: "point", x: PLACES.burnedCart.x, y: PLACES.burnedCart.y - 40, zoom: 1.35 });
      yield* story.world.walk([lynn, du], { x: PLACES.burnedCart.x - 60, y: PLACES.burnedCart.y - 20 }, { limit: seconds(8) });
      yield* say(story, du, "是咱们的补给车。车夫……");
      yield* beat(1);
      yield* say(story, lynn, "胸口一支箭。箭头是空心的，里面还有余温。");
      yield* say(story, lynn, "火花箭。烬族的。");
      yield* say(story, du, "看地上这爪印，三趾、带焦痕——是烬犬。灰原的畜生，二十年没过界了。");
      yield* say(story, bo, "盟约……盟约不是还在吗？");
      yield* say(story, du, "盟约是纸。纸，最怕火。");
    });
    stones.progress("3/3");
    stones.done();
    reward(story, 40);

    // ---- The first choice.
    const choice = yield* stage.choose(
      "烬犬的足迹向东北延伸，消失在雾里。守望塔在身后。",
      [
        { id: "follow", text: "追踪烬犬的足迹——现在不追，痕迹就散了。" },
        { id: "report", text: "先回守望塔报信——四个人，不够打一场仗。" },
      ],
      { id: "tracks", speaker: lynn },
    );
    story.vars.choices.tracks = choice;
    if (choice === "follow") {
      yield* say(story, lynn, "追。痕迹比信跑得快。");
      yield* say(story, du, "好。老规矩：我走前面，你看着我背后。");
      yield* houndDen(story, [lynn, du, wen, bo]);
    } else {
      yield* say(story, lynn, "回塔。先让塔上点烽火。");
      yield* say(story, du, "明智。……不过它们大概不会让咱们走得太舒服。");
      yield* houndsOnTheRoad(story, [lynn, du, wen, bo]);
    }

    // ---- Smoke over Reedholm.
    villageScenery(story, { burning: 3 });
    yield* cutscene(story, function* () {
      yield* story.stage.framing({ mode: "point", x: PLACES.reedholm.x, y: PLACES.reedholm.y, zoom: 0.8 });
      yield* beat(2.5);
      yield* say(story, wen, "队长！东北边——那是……芦苇渡的方向！", { tone: "shout" });
      yield* say(story, lynn, "烟。好多烟。");
      yield* say(story, du, "他们不是来偷东西的。他们是来点火的。");
      yield* say(story, lynn, "全速去芦苇渡！", { tone: "shout" });
      yield* stage.fadeTo(1, seconds(1.6));
    });
    sweep(story, [WILD, EMBER]);
  },
};

// Wolves come out of the reeds at the party: a pack that fights while it outnumbers them and runs when it does not.
function* wolves(story: AshenStory, party: Unit[]): Operation<void> {
  const { world, stage } = story;
  const pack = [...world.spawnGroup(CAST.fenWolf, WILD, PLACES.wolfReeds, 6, { spread: 80 }), world.spawn(CAST.fenWolfAlpha, WILD, { x: PLACES.wolfReeds.x + 60, y: PLACES.wolfReeds.y + 70 })];
  stage.bark(pack[0]!, "嗷呜——", { tone: "shout", span: seconds(1.4) });
  yield* spawn(function* shout() {
    yield* wait(seconds(0.8));
    stage.bark(party[1]!, "狼！背靠背！", { tone: "shout" });
  });
  const squad = yield* world.squad(WILD, pack, { kind: "hunt", targetIds: party.map((unit) => unit.id) }, { nerve: 0.35 });
  const fight = yield* race({
    beaten: () => until(() => squad.alive().length === 0),
    fled: () => until(() => squad.alive().length <= 1 && squad.alive().every((wolf) => distance(wolf, party[0]!) > 500)),
  });
  squad.task.halt();
  for (const wolf of squad.alive()) world.move([wolf], { x: wolf.x + 900, y: wolf.y + 600 });
  if (fight.kind === "fled") stage.bark(party[0]!, "跑了。让它去。");
  yield* beat(1.5);
  for (const wolf of world.units({ owner: WILD })) world.remove(wolf);
}

// The trail leads to a hound-master feeding his pack; he has been drawing maps.
function* houndDen(story: AshenStory, party: Unit[]): Operation<void> {
  const { world, stage } = story;
  stage.prop("campfire", PLACES.houndDen);
  stage.prop("crate", { x: PLACES.houndDen.x + 60, y: PLACES.houndDen.y - 30 });
  const master = world.spawn(CAST.ashRaider, EMBER, { x: PLACES.houndDen.x + 30, y: PLACES.houndDen.y + 10 });
  const hounds = world.spawnGroup(CAST.cinderHound, EMBER, { x: PLACES.houndDen.x - 20, y: PLACES.houndDen.y + 40 }, 4, { spread: 70 });
  yield* marked(story, "quest", PLACES.houndDen, function* () {
    yield* until(() => world.distance(party[0]!, PLACES.houndDen) < 560);
  });
  yield* cutscene(story, function* () {
    yield* story.stage.framing({ mode: "point", x: PLACES.houndDen.x, y: PLACES.houndDen.y, zoom: 1.2 });
    yield* say(story, master, "吃吧，吃饱了才跑得动。明天还有一整个村子等着你们。");
    yield* say(story, master, "……谁？", { tone: "shout" });
  });
  const squad = yield* world.squad(EMBER, [master, ...hounds], { kind: "attack", at: party[0]! }, { nerve: 0.3 });
  yield* until(() => squad.alive().length === 0);
  squad.task.halt();
  reward(story, 40);
  yield* cutscene(story, function* () {
    yield* story.world.walk([party[0]!], { x: PLACES.houndDen.x + 40, y: PLACES.houndDen.y - 20 }, { limit: seconds(8) });
    yield* say(story, party[0]!, "他在画图。……芦苇渡。渡口、水井、每一间房子。");
    yield* say(story, party[1]!, "探路的狗，画图的人。后面跟着的，就是放火的了。");
  });
}

// Walking back toward the tower, the hounds find the patrol first.
function* houndsOnTheRoad(story: AshenStory, party: Unit[]): Operation<void> {
  const { world, stage } = story;
  const back = { x: PLACES.stones[1].x - 200, y: PLACES.stones[1].y - 120 };
  yield* marked(story, "quest", back, function* () {
    yield* until(() => world.distance(party[0]!, back) < 500);
  });
  const hounds = world.spawnGroup(CAST.cinderHound, EMBER, ring(party[0]!, 520, 3, 7), 5, { spread: 60 });
  stage.bark(party[1]!, "雾里有火光——是狗！", { tone: "shout" });
  const squad = yield* world.squad(EMBER, hounds, { kind: "hunt", targetIds: party.map((unit) => unit.id) }, { nerve: 0.3 });
  yield* until(() => squad.alive().length === 0);
  squad.task.halt();
  reward(story, 40);
  const runner = world.spawn(CAST.villager, "fenfolk", { x: PLACES.reedholm.x - 900, y: PLACES.reedholm.y + 700 });
  stage.cast(runner, { name: "报信的村民", color: "#8a6a3a" });
  world.move([runner], party[0]!);
  yield* until(() => world.distance(runner, party[0]!) < 140 || !world.alive(runner));
  yield* cutscene(story, function* () {
    yield* say(story, runner, "守、守望者大人！芦苇渡……芦苇渡着火了！", { tone: "shout" });
    yield* say(story, party[0]!, "多少人？");
    yield* say(story, runner, "数不清……还有狗，好多狗……");
  });
  world.remove(runner);
}

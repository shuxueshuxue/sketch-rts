import type { Game } from "../shared/sim";
import type { GameSnapshot, PlayerId } from "../shared/types";
import type { StoryDriver } from "../recorder/scene";
import { enlist, modelBook, type CastBook, type PropPainter } from "./cast";
import { Director, type PlayerControls, type StorySave } from "./director";
import { scope, type Operation } from "./kernel";
import { Party, type Gear, type HeroRecord } from "./rpg";
import type { Stage, Text } from "./stage";
import { World } from "./world";

// @@@story-campaign - A campaign is a value: its cast, its gear, the world it opens on, its chapters in order and the
// story variables that carry from one to the next. Each chapter runs in a scope of its own, so whatever a chapter set
// going (squads, powers, ambience, markers) ends with it, and a chapter's start is a checkpoint a save can return to.
// What must outlive a chapter lives in the variables (plain data) or on the field (the units).

export type StoryVars = { heroes: Record<string, HeroRecord> };

export type Story<Vars extends StoryVars> = {
  readonly world: World;
  readonly stage: Stage;
  readonly party: Party;
  readonly vars: Vars;
  readonly director: Director<Vars>;
};

export type Chapter<Vars extends StoryVars> = {
  id: string;
  title: Text;
  play(story: Story<Vars>): Operation<void>;
};

export type Campaign<Vars extends StoryVars> = {
  id: string;
  title: Text;
  player: PlayerId;
  cast: CastBook;
  // Painters for the scenery the chapters set on the map (see stage props), by kind.
  scenery: Readonly<Record<string, PropPainter>>;
  gear: Readonly<Record<string, Gear>>;
  vars(): Vars;
  // The world before the first chapter: map, players and teams (the chapters bring on everything else).
  world(): Game;
  chapters: readonly Chapter<Vars>[];
  // The whole-campaign ambience a story runs beside its chapters (a hero's level-up flourish and the like).
  onLevel?: (story: Story<Vars>, hero: { unitId: string; name: Text }, level: number) => void;
  // The self-playing player, when the campaign is played by script (a recording). It gets what a human player has:
  // the controls (commands, answers) and the screen (the game and the stage), never the story itself.
  pilot?: (controls: PlayerControls, resumeAt: string | undefined) => Operation<void>;
  // Where a recording's camera rests by default.
  focus?: (snapshot: GameSnapshot) => { x: number; y: number } | undefined;
};

export function defineCampaign<Vars extends StoryVars>(campaign: Campaign<Vars>): Campaign<Vars> {
  const ids = new Set<string>();
  for (const chapter of campaign.chapters) {
    if (ids.has(chapter.id)) throw new Error(`Chapter ${chapter.id} appears twice in ${campaign.id}`);
    ids.add(chapter.id);
  }
  return campaign;
}

export type CampaignRun<Vars extends StoryVars> = { director: Director<Vars>; story: () => Story<Vars> };

// Starts a campaign from its first chapter (or `from`, for working on one chapter at a time).
export function startCampaign<Vars extends StoryVars>(campaign: Campaign<Vars>, options: { from?: string; seed?: number; pilot?: boolean } = {}): CampaignRun<Vars> {
  const game = campaign.world();
  enlist(game, campaign.cast);
  let story: Story<Vars> | undefined;
  const director = new Director<Vars>({
    id: campaign.id,
    game,
    player: campaign.player,
    vars: campaign.vars(),
    story: (self) => play(campaign, self, { chapter: options.from, resuming: false }, (built) => (story = built)),
    ...(campaign.pilot && options.pilot !== false ? { pilot: (controls: PlayerControls, resumeAt: string | undefined) => campaign.pilot!(controls, resumeAt ?? options.from) } : {}),
    seed: options.seed ?? 1,
  });
  director.begin();
  return { director, story: () => story! };
}

export function loadCampaign<Vars extends StoryVars>(campaign: Campaign<Vars>, save: StorySave<Vars>, options: { pilot?: boolean } = {}): CampaignRun<Vars> {
  let story: Story<Vars> | undefined;
  const director = Director.load<Vars>(
    {
      id: campaign.id,
      player: campaign.player,
      story: (self, resumeAt) => play(campaign, self, { chapter: resumeAt, resuming: true }, (built) => (story = built)),
      ...(campaign.pilot && options.pilot !== false ? { pilot: (controls: PlayerControls, resumeAt: string | undefined) => campaign.pilot!(controls, resumeAt) } : {}),
    },
    save,
  );
  return { director, story: () => story! };
}

// `entry.chapter` is where to begin (the first chapter when absent); `resuming` when a save is being loaded, whose
// checkpoint is that chapter's start.
function* play<Vars extends StoryVars>(campaign: Campaign<Vars>, director: Director<Vars>, entry: { chapter: string | undefined; resuming: boolean }, expose: (story: Story<Vars>) => void): Operation<void> {
  const world = new World(director.game, director.stage, campaign.cast, () => director.random());
  let story: Story<Vars> | undefined;
  const party = new Party(world, director.vars.heroes, campaign.gear, (hero, level) => campaign.onLevel?.(story!, { unitId: hero.unitId, name: hero.member.name }, level));
  story = { world, stage: director.stage, party, vars: director.vars, director };
  expose(story);
  director.stage.partyView = () => party.view();
  director.stage.levels = (unitId) => {
    const member = world.unit(unitId)?.variant;
    return member && party.hero(member) ? party.levelOf(member) : undefined;
  };
  const start = entry.chapter === undefined ? 0 : campaign.chapters.findIndex((chapter) => chapter.id === entry.chapter);
  if (start < 0) throw new Error(`${campaign.id} has no chapter ${entry.chapter}`);
  for (const [index, chapter] of campaign.chapters.entries()) {
    if (index < start) continue;
    // Resuming a save starts right at its checkpoint; otherwise every chapter's start is one.
    if (index !== start || !entry.resuming) yield* director.checkpoint(chapter.id);
    const current = story;
    director.stage.chapter = chapter.id;
    // Nothing but data outlives a chapter: a loaded save restarts the story at a chapter's start, so every task,
    // the party's watch over levels included, starts there too, on the same tick in the same order.
    yield* scope(function* playChapter() {
      yield* party.watch();
      yield* chapter.play(current);
    }, `chapter:${chapter.id}`);
  }
}

// A campaign as the recorder films it.
export function campaignDriver<Vars extends StoryVars>(campaign: Campaign<Vars>, options: { from?: string; seed?: number } = {}): StoryDriver {
  const run = startCampaign(campaign, options);
  const models = modelBook(campaign.cast);
  return {
    game: run.director.game,
    advance: () => run.director.advance(),
    get finished() {
      return run.director.finished;
    },
    view: () => run.director.stage.view(),
    models,
    props: (kind) => campaign.scenery[kind],
    focus: (snapshot) => campaign.focus?.(snapshot),
  };
}

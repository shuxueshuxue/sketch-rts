import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCanvasArtCache } from "./atlas-art";
import * as atlasArt from "./atlas-art";
import { setScratchCanvasFactory } from "./art/scratch-canvas";
import { UnitFacingTracker } from "./unit-facing";
import { CombatPresentationTracker } from "./combat-presentation";
import { UnitAnimationTracker } from "./unit-animation";
import { UnitMotionSmoother } from "./unit-motion";
import { RELATION_INK } from "./relations";
import { drawWorld, ownerInk, trackUnitFacing, worldLabelsFor, type WorldFrame } from "./world-renderer";
import { createI18n } from "./i18n";
import { sketchScene } from "../sdk/scene";
import { ABILITY_DEFS } from "../shared/catalog";
import { createGame, snapshotGame, stepGame } from "../shared/sim";
import { boardUnit } from '../shared/decks';
import { beginShipBoarding, gangwaySurface, updateShipGangways } from '../shared/ship-gangway';
import { shipProfile } from '../shared/ship-geometry';
import { createBuilding, createUnit } from '../shared/map';
import type { GameSnapshot, TrainingJob } from "../shared/types";

type Call = { name: string; args: unknown[]; at?: Transform; ink?: unknown };
type Transform = { a: number; b: number; c: number; d: number; e: number; f: number };

// A 2D context that records every call; it keeps only the transform, which the atlas reads for sprite resolution and
// each drawImage carries (a unit turned to face left is drawn mirrored about its own spot).
function recordingContext() {
  const calls: Call[] = [];
  let transform: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: Transform[] = [];
  const gradient = () => ({ addColorStop() {} });
  const methods: Record<string, (...args: never[]) => unknown> = {
    save: () => void stack.push({ ...transform }),
    restore: () => void (transform = stack.pop() ?? transform),
    scale: (x: number, y: number) => void (transform = { ...transform, a: transform.a * x, b: transform.b * x, c: transform.c * y, d: transform.d * y }),
    translate: (x: number, y: number) => void (transform = { ...transform, e: transform.e + transform.a * x + transform.c * y, f: transform.f + transform.b * x + transform.d * y }),
    getTransform: () => ({ ...transform }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: () => ({ width: 0 }),
    // This recorder checks draw order/transforms, not raster bounds. An opaque
    // scratch surface retains the full tile; real crop pixels have their own test.
    getImageData: (_x:number,_y:number,width:number,height:number) => ({data:new Uint8ClampedArray(width*height*4).fill(255)}),
  };
  const state: Record<string, unknown> = { globalAlpha: 1, strokeStyle: "#000", fillStyle: "#000", lineWidth: 1, font: "10px sans-serif", textAlign: "start", lineCap: "butt", lineJoin: "miter", shadowBlur: 0, shadowColor: "transparent" };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      const method = methods[key];
      return (...args: unknown[]) => {
        calls.push(key === "drawImage" ? { name: key, args, at: { ...transform } } : key === "stroke" || key === "fill" || key === "fillRect" || key === "fillText" ? { name: key, args, ink: key === 'stroke' ? target.strokeStyle : target.fillStyle } : { name: key, args });
        return method?.(...(args as never[]));
      };
    },
    set(target, key, value) {
      if (typeof key === "string") target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function fakeCanvas(width: number, height: number) {
  return { width, height, getContext: () => recordingContext().ctx } as unknown as HTMLCanvasElement;
}

// Sprites are drawn scaled into a box (five arguments); the paper ground tiles are drawn as they are (three).
function spriteDraws(calls: Call[]) {
  return calls.filter((call) => call.name === "drawImage" && call.args.length === 5 && Number(call.args[3]) < 500);
}

function duelSnapshot(options: { northX?: number; southX?: number; campStock?: number; cloak?: boolean } = {}): GameSnapshot {
  const scene = sketchScene("renderer")
    .map("bareDuel")
    .replaceDefaults()
    .player("north", { team: "north", race: "grove" })
    .player("south", { team: "south", race: "ember" })
    .unit("north", "footman", options.northX ?? 300, 300, { id: "north-footman" })
    .unit("south", "footman", options.southX ?? 200, 300, { id: "south-footman", order: { type: "attack", targetId: "north-footman" } });
  if (options.campStock !== undefined) scene.mercenaryCamp("camp", 500, 420, { stock: options.campStock });
  if (options.cloak) scene.item("cloak", "flameCloak", 300, 300, { carrierId: "north-footman" });
  return snapshotGame(scene.build().createGame());
}

function frame(snapshot: GameSnapshot, overrides: Partial<WorldFrame> = {}): WorldFrame & { calls: Call[] } {
  const { ctx, calls } = recordingContext();
  return {
    ctx,
    calls,
    snapshot,
    view: { x: 0, y: 0, width: 800, height: 600 },
    now: 1000,
    facing: new UnitFacingTracker(),
    labels: { kind: (kind) => `kind:${kind}` },
    ...overrides,
  };
}

describe("world renderer", () => {
  it('draws all overlapping ground selection marks before any unit or building body',()=>{
    const snapshot=duelSnapshot({northX:300,southX:315});
    snapshot.units[1]!.y=315;
    const game=createGame('bareDuel',{aiPlayers:[]}),building=game.buildings[0]!;
    snapshot.buildings=[{...building,x:320,y:320}];
    snapshot.map.terrain={cell:32,cols:32,rows:32,cells:'.'.repeat(1024)};
    const rendered=frame(snapshot,{viewer:'north',selectedIds:new Set([snapshot.units[0]!.id,snapshot.units[1]!.id,building.id])});
    drawWorld(rendered);
    const marks=rendered.calls.map((call,index)=>({call,index})).filter(({call})=>call.name==='strokeRect' || call.name==='stroke' && [RELATION_INK.own,RELATION_INK.enemy].includes(String(call.ink)));
    const bodies=rendered.calls.map((call,index)=>({call,index})).filter(({call})=>call.name==='drawImage' && call.args.length===5 && Number(call.args[3])<500);
    expect(marks.length).toBeGreaterThanOrEqual(3);expect(bodies.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...marks.map(mark=>mark.index))).toBeLessThan(Math.min(...bodies.map(body=>body.index)));
  });
  it('keeps selection surfaces off the HUD overlay while health and persistent buffs remain',()=>{
    const snapshot=duelSnapshot(),unit=snapshot.units.find(unit=>unit.owner==='north')!;
    unit.effects=[{type:'bloodlust',remaining:40}];
    const rendered=frame(snapshot,{pass:'overlay',depthSelection:true,viewer:'north',selectedIds:new Set([unit.id]),hoveredId:unit.id});
    drawWorld(rendered);
    expect(rendered.calls.some(call=>call.name==='stroke' && call.ink===RELATION_INK.own)).toBe(false);
    expect(rendered.calls.some(call=>call.name==='stroke' && call.ink==='#d96e50')).toBe(true);
    expect(rendered.calls.some(call=>call.name==='fillRect')).toBe(true);
  });
  it('anchors persistent statuses to the projected 3D actor instead of its map position',()=>{
    const snapshot=duelSnapshot(),unit=snapshot.units.find(unit=>unit.owner==='north')!;
    unit.effects=[{type:'stun',remaining:30}];
    const rendered=frame(snapshot,{pass:'overlay',actorPositions:new Map([[unit.id,{x:550,y:440,bodyY:180,topY:100}]])});
    drawWorld(rendered);
    const stun=rendered.calls.findIndex(call=>call.name==='stroke' && call.ink==='#ffe279');
    expect(stun).toBeGreaterThan(0);
    let start=stun-1;while(start>=0 && rendered.calls[start]!.name!=='beginPath')start--;
    const points=rendered.calls.slice(start,stun).filter(call=>call.name==='moveTo'||call.name==='lineTo');
    expect(points.length).toBeGreaterThan(0);
    expect(points.every(call=>Number(call.args[0])>525 && Number(call.args[0])<575 && Number(call.args[1])>85 && Number(call.args[1])<105)).toBe(true);
  });
  it('paints Canvas ship flags in assigned owner colors while relation rings stay separate', () => {
    const snapshot = duelSnapshot();
    snapshot.units = [createUnit('north-ship', 'north', 'warship', 260, 400), createUnit('south-ship', 'south', 'warship', 620, 400)];
    snapshot.players.north!.color = '#123456'; snapshot.players.south!.color = '#b95632';
    const rendered = frame(snapshot, { viewer: 'north', selectedIds: new Set(['north-ship']), hoveredId: 'south-ship' });
    drawWorld(rendered);
    const fills = rendered.calls.filter(call => call.name === 'fill').map(call => call.ink);
    expect(fills).toEqual(expect.arrayContaining(['#123456', '#b95632']));
    const strokes = rendered.calls.filter(call => call.name === 'stroke').map(call => call.ink);
    expect(strokes).toEqual(expect.arrayContaining([RELATION_INK.own, RELATION_INK.enemy]));
  });
  it('draws deck remains only in the ship group and reuses art while support moves and weather changes',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.buildings=[];game.items=[];game.resources=[];game.mercenaryCamps=[];game.shops=[];game.obstacles=[];game.map={...game.map,landmarks:[]};
    const ship=game.spawnUnit('player','warship',300,300);
    game.corpses=[{id:'deck-art-proof',unitId:'dead',kind:'footman',owner:'player',x:300,y:300,radius:18,diedAtTick:0,variant:'deck-art-proof',deck:{shipId:ship.id,x:10,y:20}}];
    const remains=vi.fn((ctx:CanvasRenderingContext2D)=>ctx.fillRect(-8,-3,16,6));
    const models=()=>({paint:()=>{},remains});
    const snapshot=snapshotGame(game);
    drawWorld(frame(snapshot,{pass:'ground',models}));
    expect(remains).not.toHaveBeenCalled();
    const first=frame(snapshot,{models});drawWorld(first);
    expect(remains).toHaveBeenCalledTimes(1);
    const live=snapshot.units[0]!;live.x+=50;live.sailing!.heading=Math.PI/2;snapshot.tick+=200;
    const moved=frame(snapshot,{models});drawWorld(moved);
    expect(remains).toHaveBeenCalledTimes(1);
    expect(moved.calls.some(call=>call.name==='rotate'&&call.args[0]===Math.PI/2)).toBe(true);
    snapshot.units=[];
    const sunk=frame(snapshot,{models});drawWorld(sunk);
    expect(spriteDraws(sunk.calls)).toHaveLength(0);
    expect(remains).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => { clearCanvasArtCache(); setScratchCanvasFactory(fakeCanvas); });
  afterEach(() => setScratchCanvasFactory(undefined));

  it('draws the physical gangway polygon in the Canvas fallback and removes it when the hulls separate', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.units = []; game.buildings = []; game.items = []; game.resources = []; game.obstacles = [];
    game.map.width = game.map.height = 2000; delete game.map.terrain;
    const source = game.spawnUnit('player', 'transport', 300, 300), target = game.spawnUnit('player', 'carrier', 300, 600), crew = game.spawnUnit('player', 'footman', 300, 300);
    target.y = source.y + (shipProfile(source)!.beam + shipProfile(target)!.beam) / 2 + 12;
    expect(boardUnit(source, crew, game.units)).toBe(true);
    source.order = { type: 'boardShip', targetId: target.id };
    expect(beginShipBoarding(game.map, game.units, source, target, game.tick, game)).toBe(true);
    const approaching = frame(snapshotGame(game)); drawWorld(approaching);
    expect(approaching.calls.filter(call => call.name === 'fill' && call.ink === '#9b7550')).toHaveLength(0);
    updateShipGangways(game.map, game.units, game.tick, game);
    const surface = gangwaySurface(source, target)!;
    const drawn = frame(snapshotGame(game)), original = JSON.stringify(drawn.snapshot); drawWorld(drawn);
    const bridgePaths = (calls: Call[]) => {
      const fill = calls.findIndex(call => call.name === 'fill' && call.ink === '#9b7550');
      let start = fill - 1;
      while (start >= 0 && calls[start]!.name !== 'beginPath') start--;
      return calls.slice(start, fill).filter(call => call.name === 'moveTo' || call.name === 'lineTo');
    };
    expect(drawn.calls.filter(call => call.name === 'fill' && call.ink === '#9b7550')).toHaveLength(1);
    expect(bridgePaths(drawn.calls).map(call => Number(call.args[0])).sort((a, b) => a - b)).toEqual(surface.polygon.map(point => point.x).sort((a, b) => a - b));
    expect(JSON.stringify(drawn.snapshot)).toBe(original);
    source.x += 50; target.x += 50;
    const moved = frame(snapshotGame(game)); drawWorld(moved);
    expect(bridgePaths(moved.calls).map(call => Number(call.args[0])).sort((a, b) => a - b)).toEqual(surface.polygon.map(point => point.x + 50).sort((a, b) => a - b));
    target.y += 40;
    const separated = frame(snapshotGame(game)); drawWorld(separated);
    expect(separated.calls.filter(call => call.name === 'fill' && call.ink === '#9b7550')).toHaveLength(0);
  });

  it('draws no body, health, selection ring or reticle for a sheltered person in either canvas pass',()=>{
    const original=duelSnapshot(),unit=original.units.find(unit=>unit.owner==='north')!;
    const snapshot={...original,units:[unit],buildings:[],resources:[],items:[],mercenaryCamps:[],effects:[],projectiles:[]};
    unit.deck={shipId:'shelter',x:0,y:0};unit.cabin={shipId:'shelter',breached:true};unit.hp=1;
    unit.aim={x:450,y:300,anchorX:unit.x,anchorY:unit.y,tracking:true,updatedTick:1};unit.order={type:'aim',x:450,y:300};
    for(const pass of [undefined,'overlay'] as const){
      const rendered=frame(snapshot,{...(pass?{pass}:{}),viewer:'north',selectedIds:new Set([unit.id]),hoveredId:unit.id});
      drawWorld(rendered);
      expect(spriteDraws(rendered.calls)).toHaveLength(0);
      expect(rendered.calls.filter(call=>call.name==='stroke' && ['#c59b56',RELATION_INK.own].includes(String(call.ink)))).toHaveLength(0);
    }
  });

  it("draws prepared reticles only for the owning viewer, excluding allies and spectators", () => {
    const snapshot = duelSnapshot();
    const unit = snapshot.units.find(unit => unit.owner === "north")!;
    unit.kind = "archer";
    unit.order = { type: "aim", x: 450, y: 300 };
    unit.aim = { x: 360, y: 300, anchorX: unit.x, anchorY: unit.y, tracking: true, updatedTick: 1 };
    snapshot.players.ally = { ...snapshot.players.north! };
    snapshot.teams = { ...snapshot.teams, ally: snapshot.teams?.north ?? "north" };
    for (const viewer of ["north", "south", "ally", undefined]) {
      const rendered = frame(snapshot, { ...(viewer ? { viewer } : {}) });
      drawWorld(rendered);
      const strokes = rendered.calls.filter(call => call.name === "stroke" && call.ink === "#c59b56");
      expect(strokes.length).toBe(viewer === "north" ? 2 : 0);
    }
  });

  it("draws every unit in view through the atlas and mirrors one that faces left", () => {
    // south attacks north from the left, so it faces right; north has never moved and faces right too.
    const facingRight = frame(duelSnapshot({ northX: 300, southX: 200 }));
    drawWorld(facingRight);
    expect(spriteDraws(facingRight.calls)).toHaveLength(2);
    expect(facingRight.calls.filter((call) => call.name === "scale" && call.args[0] === -1)).toHaveLength(0);

    // Now south attacks from the right: it turns to face left and its sprite is drawn mirrored.
    const facingLeft = frame(duelSnapshot({ northX: 200, southX: 300 }));
    drawWorld(facingLeft);
    expect(facingLeft.facing.facing("south-footman")).toBe(-1);
    expect(spriteDraws(facingLeft.calls)).toHaveLength(2);
    expect(facingLeft.calls.filter((call) => call.name === "scale" && call.args[0] === -1 && call.args[1] === 1)).toHaveLength(1);
  });

  it('mirrors attached blood with the rendered recovery pose, not a new order facing behind it',()=>{
    const drawUnit=vi.spyOn(atlasArt,'drawAtlasUnit');
    const snapshot=duelSnapshot({northX:300,southX:400}),actor=snapshot.units.find(unit=>unit.id==='north-footman')!;
    actor.order={type:'attack',targetId:'south-footman'};
    snapshot.effects=[
      {id:'held-release',type:'melee',sourceId:actor.id,actionMode:'attack',actionTick:snapshot.tick,x:400,y:300,fromX:300,fromY:300,toX:400,toY:300,duration:16,remaining:16},
      {id:'held-body-mark',type:'hit',unitId:actor.id,x:300,y:300,damage:40,targetHpAfter:60,targetMaxHp:180,targetKind:'footman',targetUnitClass:'nonMechanical',duration:14,remaining:14},
    ];
    const facing=new UnitFacingTracker(),animation=new UnitAnimationTracker(),combat=new CombatPresentationTracker();
    drawWorld(frame(snapshot,{facing,animation,combat}));
    snapshot.units.find(unit=>unit.id==='south-footman')!.x=200;snapshot.tick++;
    for(const effect of snapshot.effects)effect.remaining--;
    drawUnit.mockClear();
    const rendered=frame(snapshot,{facing,animation,combat,now:1050});drawWorld(rendered);
    expect(facing.facing(actor.id)).toBe(-1);expect(facing.releaseFacing(actor.id)).toBe(1);
    const mark=combat.frame(1050).body.find(mark=>mark.unitId===actor.id)!;
    expect(Math.abs(mark.localX)).toBeGreaterThan(.001);
    const ellipse=rendered.calls.find(call=>call.name==='ellipse'&&call.args[2]===mark.radius*.65&&call.args[3]===mark.radius)!;
    // Compare with the actual atlas anchor, including native hit shake.
    const painted=drawUnit.mock.calls.find(call=>Math.abs(call[2].x-actor.x)<25)!;
    expect(painted).toBeDefined();expect(painted[5]).toBe(1);
    expect(ellipse).toBeDefined();expect(ellipse.args[0]).toBeCloseTo(painted[2].x+mark.localX);
    drawUnit.mockRestore();
  });

  it("leaves out units outside the view", () => {
    const view = frame(duelSnapshot({ northX: 300, southX: 2000 }));
    drawWorld(view);
    expect(spriteDraws(view.calls)).toHaveLength(1);
  });

  it("zooms the whole frame and covers correspondingly less of the world", () => {
    const snapshot = duelSnapshot({ northX: 300, southX: 700 });
    const flat = frame(snapshot);
    drawWorld(flat);
    expect(spriteDraws(flat.calls)).toHaveLength(2);

    const zoomed = frame(snapshot, { view: { x: 0, y: 0, width: 800, height: 600, zoom: 2 } });
    drawWorld(zoomed);
    expect(zoomed.calls[0]).toEqual({ name: "save", args: [] });
    expect(zoomed.calls[1]).toEqual({ name: "scale", args: [2, 2] });
    expect(zoomed.calls.at(-1)).toEqual({ name: "restore", args: [] });
    // At zoom 2 an 800-pixel view spans 400 world units: the unit at x=700 is out of it.
    expect(spriteDraws(zoomed.calls)).toHaveLength(1);
  });

  it("follows the camera: the world point at the view's corner lands at the canvas origin", () => {
    const view = frame(duelSnapshot({ northX: 1300, southX: 1200 }), { view: { x: 1000, y: 100, width: 800, height: 600 } });
    drawWorld(view);
    const draws = spriteDraws(view.calls);
    expect(draws).toHaveLength(2);
    // Sprites are 128 world units square at glyph scale 1, drawn centred on the unit.
    const lefts = draws.map((call) => call.args[1] as number).sort((a, b) => a - b);
    const width = draws[0]!.args[3] as number;
    expect(lefts.map((left) => left + width / 2)).toEqual([200, 300]);
  });

  it("animates from the frame clock, never the wall clock", () => {
    const wallClock = vi.spyOn(performance, "now");
    const snapshot = duelSnapshot({ cloak: true });
    const first = frame(snapshot, { now: 500 });
    const again = frame(snapshot, { now: 500 });
    const later = frame(snapshot, { now: 900 });
    drawWorld(first);
    drawWorld(again);
    drawWorld(later);
    expect(wallClock).not.toHaveBeenCalled();
    expect(again.calls).toEqual(first.calls);
    expect(later.calls).not.toEqual(first.calls);
    wallClock.mockRestore();
  });

  it("paints the caller's words into the world", () => {
    const view = frame(duelSnapshot({ campStock: 3 }));
    drawWorld(view);
    expect(view.calls.some((call) => call.name === "fillText" && call.args[0] === "kind:mercenary ×3")).toBe(true);
  });

  it('paints an amber waiting-launch bar and localized state on an unselected visible shipyard in both render paths',()=>{
    const snapshot=duelSnapshot();snapshot.units=[];
    const dock=createBuilding('dock','north','shipyard',300,300,true);
    dock.queue=[{unitKind:'transport',remaining:0},{unitKind:'carrier',remaining:80}];snapshot.buildings=[dock];
    const original=JSON.stringify(snapshot),labels=worldLabelsFor(createI18n('en'));
    for(const pass of [undefined,'overlay'] as const){
      const rendered=frame(snapshot,{labels,...(pass?{pass}:{})});
      const measure=vi.fn(()=>({width:63.25}) as TextMetrics);rendered.ctx.measureText=measure;drawWorld(rendered);
      expect(rendered.selectedIds?.size??0).toBe(0);
      expect(rendered.calls.some(call=>call.name==='fillRect'&&call.ink==='#9a6a28'&&call.args[2]===56&&call.args[3]===5)).toBe(true);
      expect(rendered.calls.some(call=>call.name==='fillText'&&call.args[0]===`${labels.kind('transport')} x2`)).toBe(true);
      expect(rendered.calls.filter(call=>call.name==='fillText'&&call.args[0]==='Awaiting launch')).toHaveLength(1);
      expect(measure).toHaveBeenCalledWith('Awaiting launch');
      expect(rendered.calls.filter(call=>call.name==='fillRect'&&call.ink==='rgba(255, 250, 226, 0.94)')).toMatchObject([{args:[expect.any(Number),expect.any(Number),72,15]}]);
      expect(rendered.calls.find(call=>call.name==='fillText'&&call.args[0]==='Awaiting launch')?.ink).toBe('#704a20');
    }
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it('keeps ordinary production blue and does not mistake a zero-time queued hull for the completed head',()=>{
    const snapshot=duelSnapshot();snapshot.units=[];
    const labels=worldLabelsFor(createI18n('en'));
    for(const kind of ['shipyard','barracks'] as const){
      const building=createBuilding('producer','north',kind,300,300,true);
      building.queue=kind==='shipyard'?[{unitKind:'transport',remaining:10},{unitKind:'carrier',remaining:0}]:[{unitKind:'footman',remaining:0},{unitKind:'lancer',remaining:80}];
      snapshot.buildings=[building];const rendered=frame(snapshot,{labels,pass:'overlay'});drawWorld(rendered);
      expect(rendered.calls.some(call=>call.name==='fillRect'&&call.ink==='#315f87'&&call.args[3]===5)).toBe(true);
      expect(rendered.calls.some(call=>call.ink==='#9a6a28')).toBe(false);
      expect(rendered.calls.some(call=>call.name==='fillText'&&call.args[0]==='Awaiting launch')).toBe(false);
      expect(rendered.calls.some(call=>call.ink==='rgba(255, 250, 226, 0.94)')).toBe(false);
      expect(rendered.calls.some(call=>call.name==='fillText'&&call.args[0]===`${labels.kind((building.queue[0] as TrainingJob).unitKind)} x2`)).toBe(true);
    }
  });

  it('reads waiting-launch words from the live localization callback and never evaluates it for a culled yard',()=>{
    const snapshot=duelSnapshot();snapshot.units=[];
    const dock=createBuilding('dock','north','shipyard',300,300,true);dock.queue=[{unitKind:'transport',remaining:0}];snapshot.buildings=[dock];
    const i18n=createI18n('en'),labels=worldLabelsFor(i18n),waiting=vi.fn(labels.awaitingShipLaunch!);
    labels.awaitingShipLaunch=waiting;
    const en=frame(snapshot,{labels,pass:'overlay'}),measureEnglish=vi.fn(()=>({width:87.4}) as TextMetrics);en.ctx.measureText=measureEnglish;drawWorld(en);
    expect(en.calls.some(call=>call.name==='fillText'&&call.args[0]==='Awaiting launch')).toBe(true);
    expect(measureEnglish).toHaveBeenCalledWith('Awaiting launch');
    expect(en.calls.find(call=>call.name==='fillRect'&&call.ink==='rgba(255, 250, 226, 0.94)')?.args[2]).toBe(96);
    Object.assign(i18n,createI18n('zh'));
    const zh=frame(snapshot,{labels,pass:'overlay'}),measureChinese=vi.fn(()=>({width:28.2}) as TextMetrics);zh.ctx.measureText=measureChinese;drawWorld(zh);
    expect(zh.calls.some(call=>call.name==='fillText'&&call.args[0]==='待下水')).toBe(true);
    expect(zh.calls.some(call=>call.name==='fillText'&&call.args[0]==='Awaiting launch')).toBe(false);
    expect(measureChinese).toHaveBeenCalledWith('待下水');
    expect(zh.calls.find(call=>call.name==='fillRect'&&call.ink==='rgba(255, 250, 226, 0.94)')?.args[2]).toBe(37);
    expect(waiting).toHaveBeenCalledTimes(2);waiting.mockClear();dock.x=10000;
    const culled=frame(snapshot,{labels,pass:'overlay'});drawWorld(culled);
    expect(waiting).not.toHaveBeenCalled();expect(culled.calls.some(call=>call.ink==='#9a6a28')).toBe(false);
    expect(culled.calls.some(call=>call.ink==='rgba(255, 250, 226, 0.94)')).toBe(false);
  });

  it("tracks facing idempotently, so extra updates between drawn frames change nothing", () => {
    const snapshot = duelSnapshot({ northX: 200, southX: 300 });
    const once = new UnitFacingTracker();
    const twice = new UnitFacingTracker();
    trackUnitFacing(once, snapshot);
    trackUnitFacing(twice, snapshot);
    trackUnitFacing(twice, snapshot);
    expect(twice.facing("south-footman")).toBe(once.facing("south-footman"));
    expect(once.facing("south-footman")).toBe(-1);
  });

  it("glides a charging rider between snapshots on the frame clock when given a smoother, its trail with it", () => {
    const charge = ABILITY_DEFS.charge;
    if (charge.behavior !== "charge") throw new Error("charge is not a charge");
    const game = sketchScene("charge")
      .map("bareDuel")
      .replaceDefaults()
      .player("north", { team: "north", race: "grove" })
      .player("south", { team: "south", race: "ember" })
      .unit("north", "raider", 300, 300, { id: "rider" })
      .unit("south", "footman", 300 + (charge.minRange + charge.range) / 2, 300, { id: "foe" })
      .build()
      .createGame();
    let previous = snapshotGame(game);
    let current = previous;
    for (let step = 0; step < 10 && current.units.find((unit) => unit.id === "rider")!.order.type !== "charge"; step += 1) {
      stepGame(game);
      previous = current;
      current = snapshotGame(game);
    }
    const before = previous.units.find((unit) => unit.id === "rider")!;
    const after = current.units.find((unit) => unit.id === "rider")!;
    expect(after.order.type).toBe("charge");
    expect(current.effects.some((effect) => effect.type === "chargeTrail" && effect.unitId === "rider")).toBe(true);
    // The leftmost sprite in world space: the foe stands east of the rider, drawn mirrored once it turns to face it.
    const riderX = (drawn: { calls: Call[] }) => {
      const draws = spriteDraws(drawn.calls);
      return Math.min(...draws.map((call) => call.at!.e + call.at!.a * ((call.args[1] as number) + (call.args[3] as number) / 2)));
    };

    // The glide starts when the new tick is first drawn and runs one tick's time (50 ms here).
    const motion = new UnitMotionSmoother(50);
    drawWorld(frame(previous, { motion, now: 1000 }));
    const arriving = frame(current, { motion, now: 1050 });
    drawWorld(arriving);
    expect(riderX(arriving)).toBeCloseTo(before.x);
    const halfway = frame(current, { motion, now: 1075 });
    drawWorld(halfway);
    expect(riderX(halfway)).toBeCloseTo((before.x + after.x) / 2);
    const plain = frame(current);
    drawWorld(plain);
    expect(riderX(plain)).toBeCloseTo(after.x);
    // The trail's speed lines leave from the rider as drawn, not from its snapshot spot ahead: half the tick's glide
    // behind where they leave when the rider is drawn at its snapshot spot.
    const lead = (drawn: { calls: Call[] }) => Math.max(...drawn.calls.filter((call) => call.name === "moveTo").map((call) => call.args[0] as number).filter((x) => x > before.x - 40 && x <= after.x));
    expect(lead(plain) - lead(halfway)).toBeCloseTo((after.x - before.x) / 2, 0);
  });

  it("rings selected and hovered units in friend-or-foe colours to the player looking on, and in the owners' with no one", () => {
    const snapshot = snapshotGame(
      sketchScene("relations")
        .map("bareDuel")
        .replaceDefaults()
        .player("north", { team: "a", race: "grove" })
        .player("ally", { team: "a", race: "grove" })
        .player("south", { team: "b", race: "ember" })
        .unit("north", "footman", 200, 300, { id: "own" })
        .unit("ally", "footman", 320, 300, { id: "friend" })
        .unit("south", "footman", 440, 300, { id: "foe" })
        .build()
        .createGame(),
    );
    // A ring is an ellipse stroked at once; the ink it is stroked in.
    const rings = (overrides: Partial<WorldFrame>) => {
      const drawn = frame(snapshot, overrides);
      drawWorld(drawn);
      return drawn.calls.flatMap((call, index) => (call.name === "ellipse" && drawn.calls[index + 1]?.name === "stroke" ? [drawn.calls[index + 1]!.ink] : []));
    };
    const looking = rings({ viewer: "north", selectedIds: new Set(["own", "friend"]), hoveredId: "foe" });
    expect(looking).toEqual(expect.arrayContaining([RELATION_INK.own, RELATION_INK.ally, RELATION_INK.enemy]));
    const nobody = rings({ selectedIds: new Set(["own", "friend"]), hoveredId: "foe" });
    expect(nobody).toEqual(expect.arrayContaining([ownerInk("north", snapshot), ownerInk("ally", snapshot), ownerInk("south", snapshot)]));
    expect(nobody).not.toContain(RELATION_INK.ally);
  });

  it("inks the default seats and neutrals conventionally and reads each match's assigned table", () => {
    expect(ownerInk("player")).toBe("#477b91");
    expect(ownerInk("enemy")).toBe("#a85644");
    expect(ownerInk("neutral")).toBe("#704a33");
    expect(ownerInk("north")).toBe(ownerInk("north"));
    expect(ownerInk("north")).toMatch(/^#[0-9a-f]{6}$/);
    const game = createGame('bareDuel', { players: ['north', 'south'], aiPlayers: [] });
    expect(ownerInk('north', game)).toBe(game.players.north!.color);
    expect(ownerInk('south', game)).not.toBe(ownerInk('north', game));
  });
});

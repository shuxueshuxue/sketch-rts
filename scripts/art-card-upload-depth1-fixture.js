import {checksumGame} from '@depth1-sim-checksum';
import {createExactUploadObserver} from './art-card-upload-depth1-observer.mjs';
import { waitForArtGpuCompletion } from './art-gpu-completion.mjs';

const source = '/@fs' + __BENCHMARK_SOURCE_ROOT__;
const paths = ['shared/sim', 'client/world-presentation', 'client/world3d/world-layer', 'client/unit-facing', 'client/unit-animation', 'client/unit-motion', 'client/combat-presentation', 'client/projectile-origins', 'client/resources', 'client/world3d/model-library'];
const [sim, presentation, world, facing, animation, motion, combat, projectiles, resources, models] = await Promise.all(paths.map(path => import(/* @vite-ignore */ `${source}/src/${path}.ts`)));
await resources.resources.initialize();
// A second controlled presentation fixture: mixed authored assets, not a
// simulation or combat workload. The benchmark imports every production module
// from the selected source worktree and uses this identical fact program there.
const WIDTH = 1280, HEIGHT = 720, VISIBLE = 100;
const VISIBLE_KINDS = ['footman', 'lancer', 'priest', 'knight', 'golem', 'rubbleGolem', 'graniteGolem',
  'ogreWarrior', 'ogreMage', 'ogreLord', 'deepSnapper', 'spiderQueen', 'redDragon', 'ancientStag',
  'stonebackBrute', 'tidePriest', 'siegeRam', 'ballista', 'catapult', 'organGun'];
const CASTERS = new Set(['priest', 'ogreMage', 'tidePriest']);
const CARRY_KINDS = new Set(['footman', 'lancer', 'priest', 'knight', 'ogreWarrior', 'ogreMage', 'ogreLord', 'tidePriest']);
const GROUPS = ['idle', 'walk', 'attack', 'cast-or-attack', 'carry-idle-or-walk'];
const streamingMetadata = {
  name: 'mixed-large-creatures-golems-siege', authoredKinds: VISIBLE_KINDS,
  arrangement: '20 kinds with five instances each: idle, walk, attack, cast for compatible casters (attack otherwise), and retained attack direction with idle/walk. Owner alternates by instance group, so every kind appears on both teams.',
  density: 4, width: WIDTH, height: HEIGHT, zoom: .75,
  actionFacts: 'Deterministic release facts and displacement only; no simulation advances in presentation samples. Attacks and casts target positions of another visible unit. Targets may be distant because this is an asset streaming probe, not combat validation.',
};
const VIEWS = { battlefield: { x: 0, y: 0, width: WIDTH, height: HEIGHT, zoom: .75 }, empty: { x: 24000, y: 24000, width: WIDTH, height: HEIGHT, zoom: .75 } };
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b), percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1), over16_67Ms: values.filter(x => x > 1000 / 60).length, over50Ms: values.filter(x => x > 50).length };
};
// Counter reads occur after samples have finished, never inside a timer.
const counters = layer => ({ cards: layer.cardStats(), combat: layer.combatStats(), positions: layer.positions.size, render: { ...layer.renderer.info.render }, memory: { ...layer.renderer.info.memory }, viewIndex: typeof layer.viewStats === 'function' ? layer.viewStats() : null });
function makeScene(hiddenCount) {
  const game = sim.createGame('bareDuel', { aiPlayers: [], players: ['player', 'enemy'], teams: { player: 'a', enemy: 'b' } });
  for (const key of ['units', 'items', 'buildings', 'resources', 'mercenaryCamps', 'shops', 'obstacles', 'effects', 'projectiles', 'corpses']) game[key] = [];
  game.scriptedVictory = true;
  game.map.width = game.map.height = 32768;
  game.map.terrain = { cell: 64, cols: 512, rows: 512, cells: '.'.repeat(512 * 512) };
  game.map.landmarks = [];
  for (let i = 0; i < VISIBLE + hiddenCount; i++) {
    const isVisible = i < VISIBLE, n = isVisible ? i : i - VISIBLE;
    const x = isVisible ? 170 + n % 10 * 135 : 6000 + n % 100 * 145;
    const y = isVisible ? 180 + Math.floor(n / 10) * 75 : 6000 + Math.floor(n / 100) * 145;
    const instance = Math.floor(n / VISIBLE_KINDS.length), kind = VISIBLE_KINDS[n % VISIBLE_KINDS.length];
    const unit = game.spawnUnit(instance % 2 ? 'enemy' : 'player', kind, x, y);
    unit.order = { type: 'hold', x, y };
  }
  const initial = sim.snapshotGame(game), baseUnits = initial.units.map(unit => ({ ...unit }));
  const visibleIds = baseUnits.slice(0, VISIBLE).map(unit => unit.id);
  const releaseAt = (tick, period, phase) => tick < phase ? undefined : phase + Math.floor((tick - phase) / period) * period;
  const snapshotAt = tick => {
    const units = baseUnits.map((base, i) => {
      const n = i < VISIBLE ? i : i - VISIBLE, group = Math.floor(n / VISIBLE_KINDS.length) % GROUPS.length;
      // The last group tests both stationary and moving ready poses. Unarmed
      // creatures naturally return to their authored idle/walk state instead.
      const moving = group === 1 || group === 4 && n % 2 === 1;
      const dx = moving ? Math.sin(tick / 13) * 24 : 0, dy = moving ? Math.cos(tick / 17) * 10 : 0;
      return { ...base, x: base.x + dx, y: base.y + dy, cooldown: 0, abilityCooldowns: {} };
    });
    const effects = [];
    // Visible facts cannot depend on the hidden population. The nearby empty
    // camera may cull them, but their authored action histories stay untouched.
    for (const [start, count] of [[0, VISIBLE], [VISIBLE, Math.min(hiddenCount, VISIBLE)]]) {
      for (let n = 0; n < count; n++) {
        const group = Math.floor(n / VISIBLE_KINDS.length) % GROUPS.length;
        if (group < 2) continue;
        const unit = units[start + n], isCast = group === 3 && CASTERS.has(unit.kind);
        const period = group === 4 ? 120 : isCast ? 40 : 24;
        const phase = group === 4 ? 24 : Math.floor((n % VISIBLE_KINDS.length) / 5) * 6;
        const actionTick = releaseAt(tick, period, phase);
        if (actionTick === undefined) continue;
        // +/-31 slots is a diagonal of roughly 60 degrees in the unprojected
        // world; real camera projection and authored facing choose the pose.
        const targetIndex = (n + (n % 2 === 0 && group === 2 ? 31 : -31) + count) % count;
        const target = units[start + targetIndex], age = tick - actionTick;
        effects.push({ id: `release-${start}-${n}-${actionTick}`, type: 'melee', x: target.x, y: target.y,
          duration: period, remaining: period - age, actionMode: isCast ? 'cast' : 'attack', actionTick,
          sourceId: unit.id, sourceKind: unit.kind, fromX: unit.x, fromY: unit.y, toX: target.x, toY: target.y });
        // Release metadata is authoritative; the cooldown is a matching fact,
        // never a timer that the fixture uses to change simulation rules.
        unit.cooldown = group === 4 ? Math.max(0, 6 - age) : Math.max(0, period - age);
      }
    }
    return { ...initial, tick, units, effects };
  };
  return { game, snapshotAt, visibleIds, baseUnits };
}
// Reads are deliberately outside timed draws. Resident art identities retain
// the exact renderer keys, including team/facing/state/tile distinctions.
function streamingCoverage(layer, frame, scene) {
  const stateCounts = {}, carryKinds = new Set(), facings = {}, byKind = {};
  for (const unit of frame.snapshot.units.slice(0, VISIBLE)) {
    const pose = frame.animation.frame(unit, frame.now);
    stateCounts[pose.mode] = (stateCounts[pose.mode] ?? 0) + 1;
    if (pose.carry) carryKinds.add(unit.kind);
    const side = frame.facing.facing(unit.id);
    facings[side] = (facings[side] ?? 0) + 1;
    byKind[unit.kind] = (byKind[unit.kind] ?? 0) + 1;
  }
  return { ...streamingMetadata, programGroups: GROUPS, kindsExpectedToCarry: [...CARRY_KINDS],
    observedStateCounts: stateCounts, observedCarryKinds: [...carryKinds].sort(), observedFacings: facings,
    visibleKindCounts: byKind, visibleIds: scene.visibleIds,
    residentKeys: [...layer.cards.cards.keys()].sort(), residentKeyCount: layer.cards.cards.size };
}

function createFrame(scene) {
  const canvas = document.createElement('canvas'); canvas.className = 'game-canvas'; canvas.width = WIDTH; canvas.height = HEIGHT;
  document.querySelector('#mount').append(canvas);
  const view = new presentation.WorldPresentation(canvas);
  const frame = { ctx: canvas.getContext('2d'), snapshot: scene.snapshotAt(0), view: VIEWS.battlefield, now: 0,
    facing: new facing.UnitFacingTracker(), animation: new animation.UnitAnimationTracker(), motion: new motion.UnitMotionSmoother(),
    combat: new combat.CombatPresentationTracker(), projectiles: new projectiles.ProjectileOriginTracker(),
    viewer: 'player', selectedIds: new Set([scene.visibleIds[0]]), labels: { mercenaryStock: () => '', unitKind: () => '' } };
  return { canvas, view, frame };
}
function capture(view, canvas) {
  const output = document.createElement('canvas'); output.width = WIDTH; output.height = HEIGHT;
  const ctx = output.getContext('2d'); ctx.fillStyle = '#182526'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(view.ground, 0, 0); ctx.drawImage(view.actors, 0, 0); ctx.drawImage(canvas, 0, 0);
  return output.toDataURL('image/png');
}
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, options) {
  return originalGetContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
};

const pickGrid=view=>{const values=[];for(let y=12;y<HEIGHT;y+=24)for(let x=12;x<WIDTH;x+=24)values.push({x,y,hit:view.pick({x,y})??null});return values;};
async function actualGameplay(){
 const surfaces=await import(/* @vite-ignore */ source+'/src/client/combat-surfaces.ts');
 const game=sim.createGame('bareDuel',{aiPlayers:[],scenario:{replaceDefaultUnits:true,replaceDefaultBuildings:true,replaceDefaultResources:true,replaceDefaultMercenaryCamps:true,replaceDefaultLandmarks:true}});game.scriptedVictory=true;
 const caster=game.spawnUnit('player','summoner',930,490),oldIds=new Set(game.units.map(u=>u.id));
 sim.issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[caster.id]});sim.issuePlayerCommand(game,'player',{type:'cast',unitId:caster.id,ability:'summon',x:930,y:660});
 const spirit=game.units.find(u=>!oldIds.has(u.id));if(spirit?.kind!=='spirit')throw new Error('Actual summon failed');sim.removeUnit(game,caster.id);sim.issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[spirit.id]});
 const attacker=game.spawnUnit('enemy','footman',980,660);sim.issuePlayerCommand(game,'enemy',{type:'attack',unitIds:[attacker.id],targetId:spirit.id});
 const scene={snapshotAt:()=>sim.snapshotGame(game),visibleIds:[spirit.id,attacker.id]},prepared=createFrame(scene),{canvas,view,frame}=prepared;frame.view={x:640,y:470,width:WIDTH,height:HEIGHT,zoom:1.5};
 const snapshots=[],checksums=[],captures=[],hits=[],seen=new Set(),bloodCounts=[],captureTicks=new Set([0,18,19,36,55,74,93,112,120,180,302]);let deadTick=null;
 try{await view.prepare(frame.snapshot,'home');if(!view.is3D)throw new Error('Actual gameplay requires original WebGL presentation');
  for(let n=0;n<=302;n++){
   const snapshot=sim.snapshotGame(game),before=checksumGame(game);frame.snapshot=snapshot;frame.now=game.tick*50;frame.animation.update(snapshot,frame.now);frame.facing.updateSnapshot(snapshot,id=>snapshot.units.find(u=>u.id===id));frame.combat.update(snapshot,frame.now,surfaces.bloodSurfaceResolver(snapshot,frame.animation,frame.facing,undefined));
   const blood=frame.combat.frame(frame.now),counts={air:blood.droplets.length,ground:blood.ground.length,body:blood.body.length};bloodCounts.push({tick:game.tick,...counts});if(Object.values(counts).some(v=>v!==0))throw new Error('Actual spirit gameplay produced blood');
   for(const effect of snapshot.effects)if(effect.type==='hit'&&!seen.has(effect.id)){seen.add(effect.id);hits.push({tick:game.tick,effect});}
   if(deadTick===null&&!snapshot.units.some(u=>u.id===spirit.id))deadTick=game.tick;
   if(captureTicks.has(n)){view.draw(frame,'home');await waitForArtGpuCompletion(view.context);captures.push({tick:game.tick,png:capture(view,canvas),picks:pickGrid(view),cards:view.layer.cardStats(),gpuInk:view.layer.combatStats()});}
   const after=checksumGame(game);if(before!==after)throw new Error('Actual draw changed simulation checksum');snapshots.push(snapshot);checksums.push({tick:game.tick,beforeDraw:before,afterDraw:after});if(n<302)sim.stepGame(game);
  }
  const spiritTargetHits=hits.filter(hit=>hit.effect.unitId===spirit.id),glError=view.context.getError();if(deadTick!==112||hits.length!==11||spiritTargetHits.length!==6||glError!==0){window.__exactReplayFailure={label:'actualGameplay',deadTick,totalHits:hits.length,spiritTargetHits:spiritTargetHits.length,glError};throw new Error('Actual spirit death/hit/native GL proof failed');}
  return{passed:true,scope:'Actual original summon and enemy attack command, no gameplay stats changed. Every 303 authoritative snapshots/checksums, 11 actual GPU/Canvas captures and untimed pick grids; no timing claim.',spiritId:spirit.id,attackerId:attacker.id,deadTick,hits,spiritTargetHits,snapshots,checksums,bloodCounts,captures};
 }finally{view.dispose();canvas.remove();}
}
const uploadObserver=await createExactUploadObserver({sourceRoot:__BENCHMARK_SOURCE_ROOT__});
async function prepareExactPrefix(){
 const scene=makeScene(0),{canvas,view,frame}=createFrame(scene);await view.prepare(frame.snapshot,'home');if(!view.is3D)throw new Error('Exact replay needs real WorldPresentation');
 const layer=view.layer,gl=view.context,restore=layer.renderer.render;uploadObserver.registerLayer(layer);
 const update=n=>{frame.now=n*1000/60;const tick=Math.floor(n/3);if(frame.snapshot.tick!==tick)frame.snapshot=scene.snapshotAt(tick);frame.view=VIEWS.battlefield;return tick;};
 for(let n=0;n<54;n+=3){update(n);view.draw(frame,'home');await waitForArtGpuCompletion(gl);}
 layer.renderer.render=()=>{};
 for(let n=54;n<=134;n++){await new Promise(resolve=>requestAnimationFrame(resolve));update(n);view.draw(frame,'home');}
 return{scene,canvas,view,frame,layer,gl,restore,update,dispose(){layer.renderer.render=restore;uploadObserver.cleanupLayer(layer);view.dispose();canvas.remove();}};
}
window.cardUploadReplay={ready:true,
 async capture(){const prepared=await prepareExactPrefix();try{prepared.update(135);const before=await uploadObserver.beginCapture(prepared.layer,prepared.frame);prepared.view.draw(prepared.frame,'home');const result=await uploadObserver.endCapture(prepared.layer,before);result.pixelFacts={tick:prepared.frame.snapshot.tick,units:prepared.frame.snapshot.units.slice(0,VISIBLE),effects:prepared.frame.snapshot.effects};prepared.restore.call(prepared.layer.renderer,prepared.layer.scene,prepared.layer.camera);
   result.visualCompletion=await waitForArtGpuCompletion(prepared.gl);
   result.screenshot=capture(prepared.view,prepared.canvas);result.picks=pickGrid(prepared.view);
   result.screenshotScope='Untimed direct real render of n135 after event/state capture; no second view.draw or uploader event.';return result;}finally{prepared.dispose();}},
 async actual(corpus){const result=await this.capture();return{validation:uploadObserver.validateActualCapture(result,corpus),pixelFacts:result.pixelFacts,glContentSequence:result.glContentSequence,picks:result.picks,screenshot:result.screenshot};},
 actualGameplay,
 async replay(policy,corpus){if(!['frame-end','each-layer','validate','stage-query'].includes(policy))throw new Error('Invalid exact replay fence policy');const prepared=await prepareExactPrefix();try{prepared.update(135);return await uploadObserver.replay(prepared.layer,corpus,policy);}finally{prepared.dispose();}},
 teardown(){models.worldModels.dispose();resources.resources.dispose();return true;}
};

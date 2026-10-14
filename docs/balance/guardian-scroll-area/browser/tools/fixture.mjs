import { sketchScene } from '/src/sdk/scene.ts';
import { issueCommand, snapshotGame } from '/src/shared/sim.ts';
import { GUARDIAN_SCROLL } from '/src/shared/item-rules.ts';
import { RULES_VERSION } from '/src/shared/rules-version.ts';
import { WorldPresentation } from '/src/client/world-presentation.ts';
import { worldLabelsFor } from '/src/client/world-renderer.ts';
import { UnitFacingTracker } from '/src/client/unit-facing.ts';
import { createI18n } from '/src/client/i18n.ts';
import { resources } from '/src/client/resources.ts';
import { worldModels } from '/src/client/world3d/model-library.ts';

window.guardianProofReady = (async () => {
  const name = new URL(location.href).searchParams.get('name');
  const fixture = [
    { id:'north-inner',x:1500,y:1340,distance:160 }, { id:'north-outer',x:1500,y:1280,distance:220 },
    { id:'south-inner',x:1500,y:1660,distance:160 }, { id:'south-outer',x:1500,y:1720,distance:220 },
    { id:'east-inner',x:1660,y:1500,distance:160 }, { id:'east-outer',x:1720,y:1500,distance:220 },
    { id:'west-inner',x:1340,y:1500,distance:160 }, { id:'west-outer',x:1280,y:1500,distance:220 },
  ];
  let scene = sketchScene('guardian-actual-webgl').map('bareDuel').replaceDefaults().player('player')
    .townHall('player',1070,1500,{id:'unchanged-native-model'})
    .unit('player','worker',1500,1500,{id:'carrier'})
    .item('scroll','guardianScroll',0,0,{carrierId:'carrier'});
  for (const actor of fixture) scene = scene.unit('player','footman',actor.x,actor.y,{id:actor.id});
  const game = scene.build().createGame();
  issueCommand(game,{type:'useItem',unitId:'carrier',itemId:'scroll'});
  const snapshot = snapshotGame(game), snapshotBefore = JSON.stringify(snapshot);
  const canvas = document.querySelector('#overlay'), ctx = canvas.getContext('2d');
  const presentation = new WorldPresentation(canvas);
  await resources.initialize();
  await presentation.prepare(snapshot,'home');
  if (!presentation.is3D) throw new Error('Actual WorldPresentation did not activate WebGL2');
  const view = {x:860,y:1180,width:1280,height:650,zoom:1};
  const frame = {ctx,snapshot,view,now:0,facing:new UnitFacingTracker(),labels:worldLabelsFor(createI18n('en')),
    viewer:'player',selectedIds:new Set(),reducedMotion:true};
  let drawCount = 0;
  const draw = () => { presentation.draw(frame,'home'); drawCount++; };
  draw();
  await new Promise(done=>requestAnimationFrame(done)); draw();
  await new Promise(done=>requestAnimationFrame(done)); draw();
  const actors = fixture.map(actor => {
    const unit=snapshot.units.find(unit=>unit.id===actor.id), protectedByScroll=unit.effects.some(effect=>effect.type==='guardian');
    const x=unit.x-view.x,y=unit.y-view.y;
    // Labels and center crosses only. The field, actors, terrain and statuses
    // were drawn by the unmodified game's ground + WebGL + overlay pipeline.
    ctx.strokeStyle='#735431';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x-3,y);ctx.lineTo(x+3,y);ctx.moveTo(x,y-3);ctx.lineTo(x,y+3);ctx.stroke();
    ctx.fillStyle=protectedByScroll?'#335d40':'#993d38';ctx.font='12px sans-serif';ctx.textAlign='center';
    ctx.fillText(`${actor.distance}: ${protectedByScroll?'PROTECTED':'OUTSIDE'}`,x,y+(actor.id.endsWith('inner')?72:48));
    return {...actor,protectedByScroll};
  });
  document.querySelector('#caption').textContent=`${name.toUpperCase()} · rules ${RULES_VERSION} · guardian radius ${GUARDIAN_SCROLL.radius} · actual WebGL2`;
  document.querySelector('#legend').textContent='160 / 220 are actual unit-center distances. Colors and shield statuses report the simulation. Native town hall is identical and outside the field.';
  const layer=presentation.layer, renderer=layer.renderer;
  const gl=document.querySelector('.world-actors').getContext('webgl2');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const model=worldModels.portraitModel('buildings/townHall');
  const stack=document.querySelector('.world-underlay');
  const report={name,rulesVersion:RULES_VERSION,radius:GUARDIAN_SCROLL.radius,view,fixture,actors,drawCount,
    field:snapshot.effects.find(effect=>effect.type==='guardianField'),
    is3D:presentation.is3D,stackVisible:!stack.hidden,canvases:[...document.querySelectorAll('canvas')].map(c=>({class:c.className,width:c.width,height:c.height})),
    renderer:{version:gl.getParameter(gl.VERSION),vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),device:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),glError:gl.getError(),info:JSON.parse(JSON.stringify(renderer.info.render))},
    model:{townHallLoaded:!!model,modelCache:worldModels.cacheStats(),visiblePositions:layer.viewStats()},
    resourceEntries:[...resources.entries.values()].map(({url,label,state,loaded,error})=>({url,label,state,loaded,...(error?{error}:{})})),
    snapshotUnchanged:snapshotBefore===JSON.stringify(snapshot),snapshotJson:JSON.stringify(snapshot)};
  if(!report.is3D||!report.stackVisible||report.renderer.glError!==0||!report.model.townHallLoaded||!report.snapshotUnchanged)
    throw new Error('Actual WebGL proof failed: '+JSON.stringify(report));
  const expected=GUARDIAN_SCROLL.radius===280?8:4;
  if(actors.filter(actor=>actor.protectedByScroll).length!==expected)throw new Error('Unexpected real scroll recipients');
  return report;
})();

// Injected into the real browser-runtime fixture by art-browser-benchmark.mjs.
// Uses real simulation outcomes; there is no synthetic animation or cooldown mutation.
const dynamicGame = sim.createGame('bareDuel', { aiPlayers: [], players: ['player','enemy'], teams: {player:'friendly',enemy:'opposing'} });
for (const key of ['units','items','buildings','resources','mercenaryCamps','shops','obstacles','effects','projectiles']) dynamicGame[key]=[];
dynamicGame.scriptedVictory=true;
const dynamicCatalog = (await import(/* @vite-ignore */ `${source}/src/shared/catalog.ts`)).UNIT_DEFS;
const dynamicKinds=Object.keys(dynamicCatalog).filter(kind=>!dynamicCatalog[kind].naval);
for(let i=0;i<1000;i++){
 const side=i<500?0:1, slot=i%500;
 const unit=dynamicGame.spawnUnit(side?'enemy':'player',dynamicKinds[slot%dynamicKinds.length],(side?1500:900)+(slot%20)*24,650+Math.floor(slot/20)*30);
 unit.hp=Math.max(1,Math.round(unit.maxHp*.75));
 unit.order={type:'attackMove',x:side?1100:1750,y:unit.y};
}
const healingCohorts=['player','enemy'].map(owner=>({owner,ids:dynamicGame.units.filter(unit=>unit.owner===owner&&dynamicCatalog[unit.kind].abilities.includes('heal')).map(unit=>unit.id)}));
for(const group of healingCohorts)if(group.ids.length)sim.issuePlayerCommand(dynamicGame,group.owner,{type:'setAutocast',unitIds:group.ids,ability:'heal',enabled:false});
const dynamicSnapshots=[],dynamicSimMs=[];
for(let tick=0;tick<60;tick++){
 if(tick===19)for(const group of healingCohorts)if(group.ids.length)sim.issuePlayerCommand(dynamicGame,group.owner,{type:'setAutocast',unitIds:group.ids,ability:'heal',enabled:true});
 const at=performance.now();sim.stepGame(dynamicGame);dynamicSimMs.push(performance.now()-at);
 dynamicSnapshots.push(sim.snapshotGame(dynamicGame));
}
const dynamicStateHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(dynamicSnapshots))))).map(x=>x.toString(16).padStart(2,'0')).join('');
const dynamicProof={initialUnits:1000,kinds:dynamicKinds,stateHash:dynamicStateHash,ticks:dynamicSnapshots.map(s=>s.tick),unitCounts:dynamicSnapshots.map(s=>s.units.length),simulationValuesMs:dynamicSimMs,method:'1000 real units, every land kind, two armies of 500 attack-moving with 75% initial HP. Healing autocast is disabled with real player commands initially and re-enabled before tick 20 to exercise actual cast events during sampling. Sixty real simulation ticks precomputed once; identical replay reused by each render cycle. Rendering cost excludes this precomputation; no AI planner. Each replay frame advances real animation/motion/facing trackers.'};

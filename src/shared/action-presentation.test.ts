import {describe,expect,it} from 'vitest';
import {createGame,issuePlayerCommand,stepGame,strikeUnit} from './sim';
import {UnitAnimationTracker} from '../client/unit-animation';
function scene(){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.effects=[];game.scriptedVictory=true;delete game.map.terrain;return game;}

describe('actual action release metadata',()=>{
  it('records the melee author separately from the victim and preserves the contact coordinates',()=>{
    const game=scene(),source=game.spawnUnit('player','footman',1000,1000),target=game.spawnUnit('enemy','footman',1030,980);
    target.hp=2;strikeUnit(game,source,target,20,'melee');
    const release=game.effects.find(effect=>effect.actionMode==='attack')!;
    expect(release).toMatchObject({sourceId:source.id,fromX:1000,fromY:1000,toX:1030,toY:980});
    expect(game.effects.find(effect=>effect.type==='hit')).toMatchObject({unitId:target.id});
    const tracker=new UnitAnimationTracker();tracker.update(game,0);
    expect(tracker.frame(source,0)).toMatchObject({mode:'attack',frame:0,direction:{x:30,y:-20}});
    expect(tracker.frame(target,0).mode).toBe('idle');
  });
  it('records an actual heal after its target is chosen, independent of the next order',()=>{
    const game=scene(),source=game.spawnUnit('player','priest',1000,1000),target=game.spawnUnit('player','footman',1000,900);
    target.hp-=50;source.autocast={heal:false};
    issuePlayerCommand(game,'player',{type:'cast',unitId:source.id,ability:'heal',targetId:target.id});
    stepGame(game);
    const release=game.effects.find(effect=>effect.actionMode==='cast')!;
    expect(release).toMatchObject({type:'heal',sourceId:source.id,fromX:1000,fromY:1000,toX:1000,toY:900});
    const tracker=new UnitAnimationTracker();tracker.update(game,0);
    expect(tracker.frame(source,0)).toMatchObject({mode:'cast',direction:{x:0,y:-100}});
  });
  it('captures summon placement rather than treating every spell as a weapon attack',()=>{
    const game=scene(),source=game.spawnUnit('player','summoner',1000,1000);
    source.autocast={summon:false};issuePlayerCommand(game,'player',{type:'cast',unitId:source.id,ability:'summon',x:1100,y:1100});
    stepGame(game);
    expect(game.effects.find(effect=>effect.actionMode==='cast')).toMatchObject({type:'summon',sourceId:source.id,fromX:1000,fromY:1000,toX:1100,toY:1100});
  });
  it('puts direction on projectile launch and never recasts it on the later hit',()=>{
    const game=scene(),source=game.spawnUnit('player','archer',1000,1000),target=game.spawnUnit('enemy','footman',1100,1000);
    source.order={type:'attack',targetId:target.id};target.order={type:'hold',x:target.x,y:target.y};
    for(let tick=0;tick<100&&!game.projectiles.length;tick++)stepGame(game);
    const release=game.effects.find(effect=>effect.actionMode==='attack'&&effect.sourceId===source.id)!;
    expect(release).toMatchObject({type:'projectile',fromX:source.x,fromY:source.y,toX:target.x,toY:target.y});
    source.order={type:'move',x:900,y:900};
    for(let tick=0;tick<100&&!game.effects.some(effect=>effect.type==='hit');tick++)stepGame(game);
    for(const impact of game.effects.filter(effect=>effect.type==='hit'))expect(impact.actionMode).toBeUndefined();
  });
});

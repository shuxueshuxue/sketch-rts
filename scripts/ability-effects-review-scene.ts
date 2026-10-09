import { UNIT_DEFS } from '../src/shared/catalog';
import { createGame, issuePlayerCommand, refreshUnitStats, snapshotGame, stepGame } from '../src/shared/sim';
import { xpStarThresholds } from '../src/shared/unit-value';
import type { UnitStatusEffect } from '../src/shared/types';
import { isVeteranActiveSkillId, type VeteranActiveSkillId } from '../src/shared/veteran-skills';

export type AbilityEffectReviewCase = 'slow' | 'poison' | 'stomp' | 'web' | 'bloodlust' | VeteranActiveSkillId;

/** Import from the Vite browser console or a screenshot harness. Every status
 * and cast is emitted by the real simulation; no render-only buff is injected. */
export function createAbilityEffectReviewScene(kind:AbilityEffectReviewCase) {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.buildings=[];game.resources=[];game.items=[];game.mercenaryCamps=[];game.obstacles=[];game.shops=[];
  game.scriptedVictory=true;delete game.map.terrain;
  if(isVeteranActiveSkillId(kind)) {
    const skill=kind;
    const caster=game.spawnUnit('player',skill==='veteranRally'?'footman':'priest',800,800);
    const recipient=game.spawnUnit('player','archer',890,800);recipient.hp-=50;
    caster.xp=xpStarThresholds(UNIT_DEFS[caster.kind])[2]!;caster.level=3;
    caster.veteranSkillChoices=['veteranResilience','veteranMobility',skill];refreshUnitStats(game,caster);
    issuePlayerCommand(game,'player',{type:'learnVeteranSkill',unitId:caster.id,skill});
    caster.autocast={heal:false,[skill]:false};
    issuePlayerCommand(game,'player',{type:'cast',unitId:caster.id,ability:skill});
    for(const unit of game.units)unit.order={type:'hold',x:unit.x,y:unit.y};
    return {game,snapshot:snapshotGame(game),sourceId:caster.id,targetId:recipient.id};
  }
  const kinds={slow:'murlocHunter',poison:'venomSpider',stomp:'graniteGolem',web:'spiderQueen',bloodlust:'ogreMage'} as const;
  const status:UnitStatusEffect['type']=kind==='stomp'?'stun':kind==='web'?'root':kind;
  const caster=game.spawnUnit('neutral',kinds[kind],800,800);
  const target=kind==='bloodlust'?game.spawnUnit('neutral','ogreWarrior',860,800)
    :game.spawnUnit('player','footman',800+(kind==='poison'?40:kind==='stomp'?80:120),800);
  const opponent=kind==='bloodlust'?game.spawnUnit('player','footman',910,800):target;
  opponent.hp=opponent.maxHp=5000;
  issuePlayerCommand(game,'player',{type:'attack',unitIds:[opponent.id],targetId:kind==='bloodlust'?target.id:caster.id});
  for(let tick=0;tick<120 && !game.units.some(unit=>unit.effects.some(effect=>effect.type===status));tick++)stepGame(game);
  const recipient=game.units.find(unit=>unit.effects.some(effect=>effect.type===status));
  if(!recipient)throw new Error(`Real simulation did not produce ${status}`);
  caster.autocast={stomp:false,web:false,bloodlust:false};
  for(const unit of game.units)unit.order={type:'hold',x:unit.x,y:unit.y};
  return {game,snapshot:snapshotGame(game),sourceId:caster.id,targetId:recipient.id};
}

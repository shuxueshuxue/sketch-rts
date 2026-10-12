import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { createGame, issuePlayerCommand } from '../shared/sim';
import { checksumGame } from '../shared/sim/checksum';
import { weaponRules } from '../shared/equipment';
import { appearanceFor } from './art/unit-appearance';
import { setScratchCanvasFactory } from './art/scratch-canvas';
import { clearCanvasArtCache, drawAtlasUnit, drawAtlasUnitFigure } from './atlas-art';
import { UnitAnimationTracker, type UnitAnimationFrame } from './unit-animation';

afterEach(() => { clearCanvasArtCache(); setScratchCanvasFactory(undefined); });

describe('equipped appearance in production render entry points', () => {
  it('updates battlefield and inventory through ordinary wield commands without rendering changing the simulation', () => {
    setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
    const game=createGame('bareDuel',{aiPlayers:[]});
    const unit=game.spawnUnit('player','footman',700,700);
    const item={id:'visual-sword',kind:'greatSword' as const,x:700,y:700,cooldownRemaining:0};
    game.items.push(item);
    issuePlayerCommand(game,'player',{type:'pickupItem',unitId:unit.id,itemId:item.id});
    const render=(portrait=false) => {
      const canvas=createCanvas(256,256),b=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      const before=checksumGame(game),appearance=appearanceFor(game,unit);
      if(portrait)drawAtlasUnitFigure(b,unit.kind,256,256,'#476f69',appearance);
      else drawAtlasUnit(b,unit.kind,{x:128,y:150},2,'#476f69',1,{mode:'idle',frame:0},appearance);
      expect(checksumGame(game)).toBe(before);
      return canvas.toBuffer('image/png');
    };
    const standard=render(),standardPortrait=render(true);
    issuePlayerCommand(game,'player',{type:'wieldItem',unitId:unit.id,itemId:item.id,hand:'right'});
    const equippedRules=weaponRules(game,unit);
    expect(appearanceFor(game,unit)).toEqual({weapon:'greatSword',shield:false});
    expect(render().equals(standard)).toBe(false);
    expect(render(true).equals(standardPortrait)).toBe(false);
    expect(weaponRules(game,unit)).toEqual(equippedRules);
    issuePlayerCommand(game,'player',{type:'wieldItem',unitId:unit.id,hand:'right'});
    expect(render().equals(standard)).toBe(true);
    expect(render(true).equals(standardPortrait)).toBe(true);
  });

  it('retains distinct attack variants and idle frames in the actual sprite cache', () => {
    setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
    const render=(pose:UnitAnimationFrame)=>{
      const canvas=createCanvas(256,256),b=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      drawAtlasUnit(b,'footman',{x:128,y:150},2,'#476f69',1,pose);
      return canvas.toBuffer('image/png').toString('base64');
    };
    expect(new Set([0,1,2].map(variant=>render({mode:'attack',frame:0,variant}))).size).toBe(3);
    expect(render({mode:'idle',frame:2})).not.toEqual(render({mode:'idle',frame:0}));
  });

  it('cannot perturb command-frame simulation through animation reads at different display rates',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]}), before=checksumGame(game);
    const tracker=new UnitAnimationTracker();tracker.update(game,0);
    for(let now=0;now<1000;now+=7)for(const unit of game.units)tracker.frame(unit,now);
    expect(checksumGame(game)).toBe(before);
  });
});

import {describe,it,expect} from 'vitest';
import type {CampaignSave} from '../campaigns/tidebound/campaign';
import {persistCampaignSave,TIDE_SAVE,TIDE_RECORD} from './campaign-save';
describe('campaign checkpoints',()=>{
 it('keeps the playable save when a defeat or victory record arrives',()=>{
  const entries=new Map<string,string>(),storage={setItem:(key:string,value:string)=>entries.set(key,value)};
  const save={snapshot:{tick:1200},state:{outcome:'playing',mission:{completed:['0']}}} as CampaignSave;
  persistCampaignSave(storage,save);const checkpoint=entries.get(TIDE_SAVE);
  for(const outcome of ['defeat','victory'] as const){persistCampaignSave(storage,{...save,state:{...save.state,outcome}});expect(entries.get(TIDE_SAVE)).toBe(checkpoint);expect(JSON.parse(entries.get(TIDE_RECORD)!).outcome).toBe(outcome);}
 });
});

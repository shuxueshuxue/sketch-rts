import {describe,it,expect} from 'vitest';
import {TideboundCampaign} from '../campaigns/tidebound/campaign';
import {snapshotGame} from './sim';
import {diffCampaignFrame,applyCampaignDelta} from './campaign-frame';
import type {CampaignFrame} from './campaign-session';
it('reconstructs authoritative frames including additions, deaths and deleted optional fields',()=>{
 const c=new TideboundCampaign();const before:CampaignFrame=structuredClone({type:'frame',snapshot:snapshotGame(c.game),state:c.state,paused:false});
 const after=structuredClone(before);after.snapshot.tick+=4;after.snapshot.units[0]!.x+=12;after.snapshot.units.shift();after.snapshot.units.push({...after.snapshot.units[0]!,id:'new-unit'});after.state.cooldowns[0]=100;after.paused=true;
 const delta=diffCampaignFrame(before,after);expect(applyCampaignDelta(before,delta)).toEqual(after);expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(after).length/10);
});
it('applies consecutive deltas without dropping unchanged units',()=>{
 const c=new TideboundCampaign();let prior:CampaignFrame=structuredClone({type:'frame',snapshot:snapshotGame(c.game),state:c.state,paused:false});let remote=structuredClone(prior);
 for(let round=0;round<4;round++){for(let i=0;i<4;i++)c.step();const next:CampaignFrame=structuredClone({type:'frame',snapshot:snapshotGame(c.game),state:c.state,paused:false});remote=applyCampaignDelta(remote,diffCampaignFrame(prior,next));expect(remote).toEqual(next);prior=next;}
});

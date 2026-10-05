import {TideboundCampaign,HERO} from '../src/campaigns/tidebound/campaign';
const c=new TideboundCampaign();console.log('initial',c.game.units.length,c.game.buildings.length);
const begin=performance.now();for(let i=0;i<200;i++)c.step();
console.log(JSON.stringify({ms:performance.now()-begin,tick:c.game.tick,units:c.game.units.length,outcome:c.state.outcome,ports:c.state.ports,hero:c.game.units.find(u=>u.id===HERO)?.hp}));

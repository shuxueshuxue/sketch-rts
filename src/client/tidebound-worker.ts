import { TideboundCampaign, HERO, RELICS } from '../campaigns/tidebound/campaign';
import { snapshotGame } from '../shared/sim';

let campaign: TideboundCampaign | undefined;
let paused = false;
let criticalArmed = true;
let baseArmed = true;
let speed = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

function publish() {
  if (campaign) postMessage({type:'frame', snapshot:snapshotGame(campaign.game), state:campaign.state, paused});
}
function notice(message: string) { postMessage({type:'notice', message}); }
function loop() {
  const start = performance.now();
  if (campaign && !paused) {
    try {
      campaign.step();
      const hero = campaign.game.units.find(u => u.id === HERO);
      if (hero && hero.hp > hero.maxHp * .5) criticalArmed = true;
      if (hero && hero.hp < hero.maxHp * .35 && criticalArmed) {
        criticalArmed = false;
        paused = true;
        notice('统帅重伤：战术暂停。治疗、撤退或点击继续。');
      }
      const base = campaign.game.buildings.find(b => b.id === 'expedition');
      if (base && base.hp > base.maxHp * .65) baseArmed = true;
      if (base && base.hp < base.maxHp * .5 && baseArmed) {
        baseArmed = false;
        paused = true;
        notice('远征司令部告急：战术暂停。清除围攻部队并派工程兵修理。');
      }
      if (campaign.state.outcome !== 'playing') paused = true;
      // Publish at 10 Hz at normal speed; the simulation remains fixed at 20 Hz.
      if (paused || campaign.game.tick % 2 === 0) publish();
      if (campaign.state.outcome === 'playing' && campaign.game.tick % 1200 === 0) {
        postMessage({type:'save', save:campaign.save()});
      }
    } catch (error) {
      paused = true;
      notice('战役暂停：' + (error instanceof Error ? error.message : String(error)));
      publish();
    }
  }
  timer = setTimeout(loop, Math.max(0, 50 / speed - (performance.now() - start)));
}
self.onmessage = ({data}) => {
  try {
    if (data.type === 'start') {
      if (timer) clearTimeout(timer);
      campaign = new TideboundCampaign(data.difficulty, data.save);
      paused = true;
      criticalArmed = baseArmed = true;
      publish();
      loop();
    }
    if (!campaign) return;
    let refusal: string | undefined;
    if (data.type === 'command') campaign.command(data.command);
    if (data.type === 'cancelRecruit') campaign.cancelRecruit(data.id);
    if (data.type === 'recruit') refusal = campaign.recruit(data.id);
    if (data.type === 'fortify') refusal = campaign.fortify(data.id, data.x, data.y);
    if (data.type === 'cast') {refusal = campaign.cast(data.index, data.x, data.y);if(!refusal)notice('已施放：'+RELICS[data.index]!.name);}
    if (data.type === 'pause') paused = data.paused;
    if (data.type === 'speed') speed = [1,2,4].includes(data.speed) ? data.speed : 1;
    if (data.type === 'save' && campaign.state.outcome === 'playing') postMessage({type:'save', save:campaign.save()});
    if (paused && data.type !== 'start') publish();
    if (refusal) notice(refusal);
  } catch (error) { notice(error instanceof Error ? error.message : String(error)); }
};

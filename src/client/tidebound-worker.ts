import { TideboundCampaign, HERO, RELICS } from '../campaigns/tidebound/campaign';
import { snapshotGame } from '../shared/sim';

let campaign: TideboundCampaign | undefined;
let paused = false;
let criticalArmed = true;
let baseArmed = true;
let speed = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastStage = 0;
let lastPublished = -Infinity;

function publish() {
  lastPublished = performance.now();
  if (campaign) postMessage({type:'frame', snapshot:snapshotGame(campaign.game), state:campaign.state, paused});
}
function notice(message: string) { postMessage({type:'notice', message}); }
function loop() {
  const start = performance.now();
  if (campaign && !paused) {
    try {
      campaign.step();
      if (campaign.state.mission.stage !== lastStage) {
        lastStage = campaign.state.mission.stage;
        paused = true;
        postMessage({type:'save', save:campaign.save()});
        notice('新任务阶段：' + campaign.state.mission.dialogue.at(-1)?.text + ' · 部署完毕后点击继续。');
      }
      const hero = campaign.game.units.find(u => u.id === HERO);
      if (hero && hero.hp > hero.maxHp * .5) criticalArmed = true;
      if (hero && hero.hp < hero.maxHp * .35 && criticalArmed) {
        criticalArmed = false;
        notice('统帅重伤：尽快治疗或撤退。');
      }
      const base = campaign.game.buildings.find(b => b.id === 'expedition');
      if (base && base.hp > base.maxHp * .65) baseArmed = true;
      if (base && base.hp < base.maxHp * .5 && baseArmed) {
        baseArmed = false;
        notice('远征司令部告急：清除围攻部队并派工程兵修理。');
      }
      if (campaign.state.outcome !== 'playing') {paused = true;postMessage({type:'save', save:campaign.save()});}
      // Publish at 10 Hz at normal speed; the simulation remains fixed at 20 Hz.
      if (paused || performance.now()-lastPublished>=100) publish();
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
      lastStage = campaign.state.mission.stage;
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
    if (data.type === 'mission') refusal = campaign.missionOrder(data.id);
    if (data.type === 'cast') {refusal = campaign.cast(data.index, data.x, data.y);if(!refusal)notice('已施放：'+RELICS[data.index]!.name);}
    if (data.type === 'pause') paused = data.paused;
    if (data.type === 'speed') speed = [1,2,4].includes(data.speed) ? data.speed : 1;
    if (data.type === 'save' && campaign.state.outcome === 'playing') postMessage({type:'save', save:campaign.save()});
    if (paused && data.type !== 'start') publish();
    if (refusal) notice(refusal);
  } catch (error) { notice(error instanceof Error ? error.message : String(error)); }
};

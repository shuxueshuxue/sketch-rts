import type { CampaignSave } from '../campaigns/tidebound/campaign';
export const TIDE_SAVE='sketch-rts-tidebound-v2';
export const TIDE_RECORD='sketch-rts-tidebound-v2-record';
/** A result must not destroy the last playable checkpoint. */
export function persistCampaignSave(storage:Pick<Storage,'setItem'>,save:CampaignSave){
 if(save.state.outcome==='playing')storage.setItem(TIDE_SAVE,JSON.stringify(save));
 else storage.setItem(TIDE_RECORD,JSON.stringify({outcome:save.state.outcome,tick:save.snapshot.tick,completed:save.state.mission.completed}));
}

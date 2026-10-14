import {NO_SOUND_PACK,type Soundboard} from './sound';
import {createI18n} from './i18n';
import {resourceText} from './resources';
import {resourcePanel} from './resource-panel';
type I18n=ReturnType<typeof createI18n>;
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
/** Shared controls for home preferences and the in-match settings dialog. */
export function soundSettingsMarkup(sound:Soundboard,i18n:I18n){
  const t=i18n.t;
  return `<fieldset class="sound-settings" data-sound-settings><legend>${escape(t('settings.sound'))}</legend>
    <label>${escape(t('settings.soundPack'))}<select data-sound-pack>${[{id:NO_SOUND_PACK,name:t('settings.soundPackNone')},...sound.packs].map(pack=>`<option value="${escape(pack.id)}" ${pack.id===(sound.pack?.id??NO_SOUND_PACK)?'selected':''}>${escape(pack.name)}</option>`).join('')}</select></label>
    <label>${escape(t('settings.effects'))}<input type="range" min="0" max="100" data-volume="effects" value="${Math.round(sound.settings.effects*100)}"></label>
    <label>${escape(t('settings.interface'))}<input type="range" min="0" max="100" data-volume="ui" value="${Math.round(sound.settings.ui*100)}"></label>
    <label class="checkbox-row"><input type="checkbox" data-mute ${sound.settings.muted?'checked':''}>${escape(t('settings.mute'))}</label>
    <details class="settings-diagnostics"><summary>${escape(resourceText('资源与性能','Resources and performance'))}</summary><button type="button" class="settings-resource-link" data-open-resources>${escape(resourceText('查看资源载入记录','View resource loading report'))}</button></details>
  </fieldset>`;
}
export function bindSoundSettings(root:ParentNode,sound:Soundboard,beforeReport:()=>void=()=>{}){
  root.querySelectorAll<HTMLInputElement>('[data-volume]').forEach(input=>input.addEventListener('input',()=>{const group=input.dataset.volume==='ui'?'ui':'effects';sound.update({[group]:Number(input.value)/100});sound.play(group==='ui'?'click':'melee');}));
  root.querySelector<HTMLSelectElement>('[data-sound-pack]')?.addEventListener('change',event=>sound.update({pack:(event.currentTarget as HTMLSelectElement).value}));
  root.querySelector<HTMLInputElement>('[data-mute]')?.addEventListener('change',event=>sound.update({muted:(event.currentTarget as HTMLInputElement).checked}));
  root.querySelector('[data-open-resources]')?.addEventListener('click',()=>{beforeReport();resourcePanel().open();});
}
let dialog:HTMLDialogElement|undefined;
export function openMatchSettings(sound:Soundboard,i18n:I18n){
  if(!dialog){dialog=document.createElement('dialog');dialog.className='game-settings';dialog.setAttribute('aria-label',i18n.t('home.settings'));dialog.addEventListener('keydown',event=>event.stopPropagation());document.body.append(dialog);}
  dialog.innerHTML=`<header><h2>${escape(i18n.t('home.settings'))}</h2><button type="button" data-settings-close aria-label="${escape(resourceText('关闭','Close'))}">×</button></header>${soundSettingsMarkup(sound,i18n)}`;
  bindSoundSettings(dialog,sound,()=>dialog!.close());dialog.querySelector('[data-settings-close]')?.addEventListener('click',()=>dialog!.close());
  if(!dialog.open)dialog.showModal();
}

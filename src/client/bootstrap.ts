import { resources,resourceText } from './resources';
import { resourcePanel } from './resource-panel';

const panel=resourcePanel();
void(async()=>{
  let game:typeof import('./main')|undefined;
  await panel.run('startup',resourceText('读取界面与字体','Loading interface and fonts'),async()=>{
    await resources.initialize();await resources.warm('startup','startup');
    panel.preparing(resourceText('准备游戏界面','Preparing interface'));game=await import('./main');
  });
  await game!.initializeVisuals();
})().catch(error=>console.error('Game startup failed',error));

/** Record the real fight and capture its last battlefield frame. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {recordScene} from '../src/recorder/record';
import {gifSink} from '../src/recorder/sinks';
import {cavalryCharge} from '../src/recorder/scenes/cavalry-charge';
mkdirSync('docs/art/corpses',{recursive:true});
const gif=gifSink('docs/art/corpses/battle.gif',{fps:15});
await recordScene(cavalryCharge,{seconds:22,fps:15,width:960,height:540,camera:{type:'fixed',x:2050,y:2048,zoom:1.15}}, [{
 async write(frame){await gif.write(frame);if(frame.index%15===0)writeFileSync('docs/art/corpses/battlefield.png',frame.canvas.toBuffer('image/png'));},
 async finish(){await gif.finish();}
}]);

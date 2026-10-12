import {createCanvas} from '@napi-rs/canvas';
import {writeFileSync} from 'node:fs';
import {paintCreature} from '../src/client/art/painted-creatures';
import {packCardPickMask} from '../src/client/world3d/card-pick-mask';
function previous(rgba:Uint8ClampedArray,width:number,height:number){const mask=new Uint8Array(Math.ceil(width*height/8));for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]!>=102){const pixel=(height-1-y)*width+x;mask[pixel>>>3]!|=1<<(pixel&7);}return mask;}
const canvas=createCanvas(704,704),b=canvas.getContext('2d'),images=[];
for(const kind of ['golem','redDragon','venomSpider','ogreMage','ancientStag'] as const){b.resetTransform();b.clearRect(0,0,704,704);b.translate(352,352);b.scale(4,4);paintCreature(b as unknown as CanvasRenderingContext2D,kind,'#477b91',{mode:'attack',frame:0,aim:4});images.push(b.getImageData(0,0,704,704).data);}
for(const rgba of images)if(!Buffer.from(previous(rgba,704,704)).equals(Buffer.from(packCardPickMask(rgba,704,704))))throw new Error('Mask mismatch');
const times={previous:[] as number[],packed:[] as number[]};
for(let round=0;round<12;round++)for(const name of (round%2?['packed','previous']:['previous','packed']) as ('previous'|'packed')[]){const fn=name==='previous'?previous:packCardPickMask,start=performance.now();for(let repeat=0;repeat<20;repeat++)for(const rgba of images)fn(rgba,704,704);if(round>1)times[name].push(performance.now()-start);}
const result={method:'Identical 704px production creature RGBA. Alternate execution order; discard two warmups; 10 samples of 100 masks. Node microbenchmark, not frame time.',samples:times,meanMs:Object.fromEntries(Object.entries(times).map(([key,v])=>[key,v.reduce((a,b)=>a+b,0)/v.length])),exact:true};
console.log(JSON.stringify(result));if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');

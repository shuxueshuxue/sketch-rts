const {createCanvas}=require(require('node:path').join(process.cwd(),'node_modules/@napi-rs/canvas'));
const mode=process.argv[2], count=Number(process.argv[3]||1200);
let canvas=createCanvas(640,640),ctx=canvas.getContext('2d',{willReadFrequently:true});
const spares=new Map();let checksum=0;
function mb(n){return Math.round(n/1048576*10)/10}
function memory(i){const m=process.memoryUsage();return{i,rss:mb(m.rss),heap:mb(m.heapUsed),external:mb(m.external),arrayBuffers:mb(m.arrayBuffers)}}
async function run(){
const samples=[memory(0)],start=performance.now();
for(let i=0;i<count;i++){
 if(mode.startsWith('new')){canvas=createCanvas(640,640);ctx=canvas.getContext('2d');}
 if(mode.includes('width'))canvas.width=640;
 else if(mode.includes('reset'))ctx.reset();
 else ctx.clearRect(0,0,640,640);
 ctx.save();ctx.translate(320,320);ctx.fillStyle='#785633';ctx.fillRect(-24,-55,48,90);ctx.beginPath();ctx.ellipse(5,-40,21,13,.2,0,7);ctx.fill();ctx.restore();
 if(mode.includes('read')){const rgba=ctx.getImageData(0,0,640,640);checksum+=rgba.data[(300*640+320)*4];}
 if(mode.includes('raw')){const rgba=canvas.data();checksum+=rgba[(300*640+320)*4];}
 if(mode.includes('yield')&&(i+1)%20===0)await new Promise(resolve=>setImmediate(resolve));
 if(mode.startsWith('crop')){
  const w=160+i%37,h=200+i%29,key=w+':'+h;
  const output=mode.includes('pool')&&spares.has(key)?spares.get(key):createCanvas(w,h);
  const target=output.getContext('2d');target.clearRect(0,0,w,h);target.drawImage(canvas,210,180,w,h,0,0,w,h);
  if(mode.includes('pool')){spares.delete(key);spares.set(key,output);if(spares.size>8){const [k,c]=spares.entries().next().value;c.width=c.height=1;spares.delete(k);}}
  else if(mode.includes('shrink'))output.width=output.height=1;
 }
 if(mode.startsWith('new')&&mode.includes('shrink'))canvas.width=canvas.height=1;
 if((i+1)%200===0)samples.push(memory(i+1));
}
const elapsed=performance.now()-start,beforeGC=memory(count);if(global.gc)global.gc();const afterGC=memory(count);
await new Promise(resolve=>setTimeout(resolve,50));const afterTurn=memory(count);
console.log(JSON.stringify({mode,count,dimensions:{width:640,height:640},explicitGCAvailable:typeof global.gc==='function',yieldEvery:mode.includes('yield')?20:null,elapsedMs:Math.round(elapsed),checksum,samples,beforeGC,afterGC,afterTurn}));
}
run();

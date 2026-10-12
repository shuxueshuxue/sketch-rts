/** Same production poses, old/new painters side by side. No invented windup. */
import {createCanvas} from '@napi-rs/canvas';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
import type {UnitKind} from '../src/shared/types';
const beforeRoot=resolve(process.argv[2]??'/tmp/sketch-guard-balance-before');
const out=resolve(process.argv[3]??'docs/art/refactor/followup/guard-balance');mkdirSync(out,{recursive:true});
const before=await import(pathToFileURL(`${beforeRoot}/src/client/art/painted-units.ts`).href);
const after=await import('../src/client/art/painted-units');
const oldRig=await import(pathToFileURL(`${beforeRoot}/src/client/art/rig.ts`).href);
const newRig=await import('../src/client/art/rig');
const {figures,creatures}=await import('../src/client/art/appearance');
const scratch=mkdtempSync('/tmp/guard-balance-review-');
const width=1440,height=960,canvas=createCanvas(width,height),b=canvas.getContext('2d');
const banks:[string,UnitKind,UnitKind][]=[['spear-sword','lancer','footman'],['mounted-heavy','knight','ogreWarrior'],['bow-fish','archer','murlocPeon']];
try{
 for(const [name,first,second] of banks){
  for(let index=0;index<144;index++){
   const tick=index%24,cycle=Math.floor(index/24),side:1|-1=cycle<3?1:-1,variant=cycle%3;
   const frame=tick-6,attacking=frame>=0&&frame<6;
   b.fillStyle='#d0c7b1';b.fillRect(0,0,width,height);b.fillStyle='#343b3b';b.font='22px sans-serif';
   b.fillText(`Directed preparation / ${name} / ${side===1?'right':'left'} / variant ${variant+1}`,24,32);
   b.font='17px sans-serif';b.fillText(`20 fps / ${attacking?`contact-to-ready sample ${frame}`:'prepared for next strike'} / same contact and timing`,24,61);
   for(let col=0;col<4;col++){
    const kind=col<2?first:second;b.fillText(`${kind} / ${col%2?'AFTER':'BEFORE 997a306'}`,135+col*340,102);
    for(let row=0;row<3;row++){
     const aim=[-4,0,4][row]!,x=195+col*340,y=290+row*275;
     const pose:UnitAnimationFrame={mode:attacking?'attack':'idle',frame:attacking?frame:0,aim,variant,...(attacking&&frame===0?{}:{carry:6,carryAim:aim})};
     b.strokeStyle='#aaa48f';b.beginPath();b.moveTo(x-125,y+43);b.lineTo(x+130,y+43);b.stroke();
     b.fillStyle='#343b3b';b.font='15px sans-serif';b.fillText(['up 60','level','down 60'][row]!,x-50,y+69);
     b.save();b.translate(x,y);b.scale(side*2.6,2.6);
     (col%2?after:before).paintFigure(b as unknown as CanvasRenderingContext2D,kind,'#486c78',pose,side);b.restore();
    }
   }
   const bytes=canvas.toBuffer('image/png');writeFileSync(`${scratch}/${String(index).padStart(4,'0')}.png`,bytes);
   if([4,6,8,9,11].includes(index))writeFileSync(`${out}/${name}-${index}.png`,bytes);
  }
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','20','-i',`${scratch}/%04d.png`,'-c:v','libx264','-pix_fmt','yuv420p',`${out}/${name}.mp4`]);
 }
 const checkCanvas=createCanvas(240,240),check=checkCanvas.getContext('2d');
 const pixelKey=(paint:typeof after.paintFigure,kind:UnitKind,pose:UnitAnimationFrame,side:1|-1)=>{
  check.clearRect(0,0,240,240);check.save();check.translate(120,155);check.scale(side,1);
  paint(check as unknown as CanvasRenderingContext2D,kind,'#486c78',pose,side);check.restore();
  return createHash('sha256').update(check.getImageData(0,0,240,240).data).digest('hex');
 };
 let unchangedContacts=0;
 for(const kind of [...Object.keys(figures),...Object.keys(creatures)] as UnitKind[])for(const mode of ['attack','cast'] as const)for(let aim=-6;aim<=6;aim++)for(let variant=0;variant<3;variant++)for(const side of [-1,1] as const){
  const pose={mode,frame:0,aim,variant};
  if(pixelKey(before.paintFigure,kind,pose,side)!==pixelKey(after.paintFigure,kind,pose,side))throw new Error(`Changed release raster: ${kind}/${mode}/${aim}/${variant}/${side}`);
  unchangedContacts++;
 }
 const measures=[];
 for(const kind of ['lancer','knight','footman'] as const)for(const aim of [-4,0,4])for(let variant=0;variant<3;variant++){
  const contact={mode:'attack',frame:0,aim,variant} as const,ready={mode:'idle',frame:0,carry:6,carryAim:aim} as const;
  const measure=(rig:typeof newRig)=>{
   const a=rig.sampleFigurePose(figures[kind]!,contact),r=rig.sampleFigurePose(figures[kind]!,ready);
   return{gripTravel:Math.hypot(a.wrist[0]-r.wrist[0],a.wrist[1]-r.wrist[1]),angleTravel:Math.abs(a.angle+a.lean-r.angle-r.lean)*180/Math.PI};
  };
  measures.push({kind,aim,variant,before:measure(oldRig),after:measure(newRig)});
 }
 writeFileSync(`${out}/review.json`,JSON.stringify({before:'997a306',unchangedContacts,fps:20,framesPerVideo:144,source:'Production painters, identical poses: six contact-to-ready samples at 50ms each, 900ms prepared idle. Three variants, both facings. Comparison board, not simulated battle.',measures},null,2)+'\n');
}finally{rmSync(scratch,{recursive:true,force:true});}

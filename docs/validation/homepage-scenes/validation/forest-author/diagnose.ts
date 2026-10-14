import {createForestHorde} from '/workspace/sketch-rts-homepage-board/src/client/menu-forest-horde';
const run=createForestHorde();
let scenery={gap:Infinity,unit:'',prop:'',time:0};
for(let i=0;i<51*30;i++){let time=i/30;run.script(run.game,time);for(const unit of run.game.units)for(const prop of run.props.filter(p=>['stone','deadTree'].includes(p.kind))){const gap=Math.hypot(prop.x-unit.x,prop.y-unit.y)-unit.radius;if(gap<scenery.gap)scenery={gap,unit:unit.id,prop:prop.kind+':'+prop.x+','+prop.y,time};}}
run.script(run.game,16.7);
console.log(JSON.stringify({scenery,meleegaps:run.game.units.filter(u=>u.order.type==='attack').map(u=>{let t=run.game.units.find(t=>u.order.type==='attack'&&t.id===u.order.targetId)!;return {source:u.id,target:t.id,gap:Math.hypot(u.x-t.x,u.y-t.y),range:u.attackRange}})},null,2));
for(const time of [0,6,16.7,31.8])for(const [w,h]of[[1440,900],[1280,720],[390,844]]){run.script(run.game,time);const f=run.frameAt!(time,w,h);const xs=run.game.units.map(u=>(u.x-f.focus.x)*f.zoom+w*f.anchorX);console.log(JSON.stringify({time,w,h,min:Math.min(...xs),max:Math.max(...xs)}));}

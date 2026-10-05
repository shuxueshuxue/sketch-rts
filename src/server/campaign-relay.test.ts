import {describe,it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import type {WebSocket} from 'ws';
import {CampaignRelay} from './campaign-relay';
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages:any[]=[];send(s:string){this.messages.push(JSON.parse(s));}close(){this.readyState=3;this.emit('close');}input(v:unknown){this.emit('message',Buffer.from(JSON.stringify(v)));}asWs(){return this as unknown as WebSocket;}}
describe('cooperative campaign rooms',()=>{
 it('keeps paused rooms alive and relays mission orders and host feedback',()=>{
  const relay=new CampaignRelay(),host=new Socket(),guest=new Socket();relay.connect(host.asWs(),'mission-room',true,'Host');relay.connect(guest.asWs(),'mission-room',false,'Guest');host.input({type:'start'});
  guest.input({type:'ping'});expect(guest.messages.at(-1).type).toBe('pong');
  guest.input({type:'action',action:{type:'mission',id:'landSouth'}});expect(host.messages.at(-1).action).toEqual({type:'mission',id:'landSouth'});
  host.input({type:'notice',message:'黄金不足'});expect(guest.messages.at(-1).message).toBe('黄金不足');
  const count=host.messages.length;guest.input({type:'action',action:{type:'mission',id:'teleport'}});expect(host.messages).toHaveLength(count);
 });
 it('shares lobby, start, frames and commands with a single authoritative host',()=>{
  const relay=new CampaignRelay(),host=new Socket(),guest=new Socket();relay.connect(host.asWs(),'test-room',true,'Host');relay.connect(guest.asWs(),'test-room',false,'Guest');
  expect(guest.messages.at(-1).members).toHaveLength(2);guest.input({type:'start'});expect(host.messages.at(-1).type).toBe('lobby');
  host.input({type:'start'});expect(guest.messages.at(-1).type).toBe('start');
  host.input({type:'frame',snapshot:{tick:20},state:{},paused:false});expect(guest.messages.at(-1).snapshot.tick).toBe(20);
  guest.input({type:'action',action:{type:'pause',paused:true}});expect(host.messages.at(-1).action).toEqual({type:'pause',paused:true});
  const count=host.messages.length;guest.input({type:'frame',snapshot:{tick:99},state:{}});guest.input({type:'action',action:{type:'speed',speed:4}});expect(host.messages).toHaveLength(count);
  host.close();expect(guest.messages.at(-1).type).toBe('ended');expect(guest.readyState).toBe(3);
 });
 it('supports late arrival and rejects missing rooms and invalid commands',()=>{
  const relay=new CampaignRelay(),host=new Socket(),guest=new Socket();relay.connect(host.asWs(),'late-room',true,'Host');host.input({type:'start'});host.input({type:'frame',snapshot:{tick:24},state:{},paused:true});relay.connect(guest.asWs(),'late-room',false,'Guest');expect(guest.messages.at(-1).snapshot.tick).toBe(24);
  const count=host.messages.length;guest.input({type:'action',action:{type:'command',command:{type:'inject'}}});expect(host.messages).toHaveLength(count);
  const missing=new Socket();relay.connect(missing.asWs(),'lost-room',false,'Guest');expect(missing.messages[0].type).toBe('error');
 });
});

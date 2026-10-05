import { isGameCommand } from './command-schema';
import type { GameCommand, GameSnapshot } from './types';
import type { CampaignState } from '../campaigns/tidebound/campaign';
export type CampaignAction =
 | {type:'command';command:GameCommand}
 | {type:'cast';index:number;x:number;y:number}
 | {type:'fortify';id:string;x:number;y:number}
 | {type:'recruit'|'cancelRecruit';id:string}
 | {type:'mission';id:'repairBeacon'|'embark'|'landNorth'|'landHeart'|'landSouth'|'escort'|'north'|'heart'|'south'}
 | {type:'pause';paused:boolean}
 | {type:'speed';speed:number}
 | {type:'save'};
export type CampaignFrame = {type:'frame';snapshot:GameSnapshot;state:CampaignState;paused:boolean};
export type CampaignLobby = {type:'lobby';roomId:string;hostId:string;members:{id:string;name:string}[];started:boolean};
export function isCampaignAction(v:unknown): v is CampaignAction {
 if(!v||typeof v!=='object')return false;
 const a=v as Record<string,unknown>;
 const point=()=>typeof a.x==='number'&&Number.isFinite(a.x)&&typeof a.y==='number'&&Number.isFinite(a.y);
 switch(a.type){
 case 'command':return isGameCommand(a.command);
 case 'cast':return Number.isInteger(a.index)&&Number(a.index)>=0&&Number(a.index)<6&&point();
 case 'fortify':return typeof a.id==='string'&&a.id.length<40&&point();
 case 'recruit':case 'cancelRecruit':return typeof a.id==='string'&&a.id.length<100;
 case 'mission':return ['repairBeacon','embark','landNorth','landHeart','landSouth','escort','north','heart','south'].includes(String(a.id));
 case 'pause':return typeof a.paused==='boolean';
 case 'speed':return [1,2,4].includes(Number(a.speed));
 case 'save':return true;
 default:return false;
 }
}

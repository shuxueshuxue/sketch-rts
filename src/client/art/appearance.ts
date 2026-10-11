/** Authored appearance and loadout, independent of combat rules and animation. */
import type { UnitKind } from '../../shared/types';
import type { EquipmentKind } from './equipment';
export type Role = 'sword' | 'pike' | 'bow' | 'priest' | 'mage' | 'witch' | 'axe' | 'worker';
export type Figure = { role: Role; weapon?: EquipmentKind; armor?: boolean; elite?: boolean; mounted?: boolean; ember?: boolean };
export const figures: Partial<Record<UnitKind, Figure>> = {
  thornSlinger:{role:'bow',weapon:'sling'}, barkMender:{role:'priest'}, gladeWitch:{role:'witch'},
  worker: { role:'worker' }, footman:{role:'sword',armor:true}, lancer:{role:'pike',armor:true},
  ashWarden:{role:'pike',armor:true,elite:true,ember:true}, archer:{role:'bow'},
  horseArcher:{role:'bow',mounted:true}, raider:{role:'sword',mounted:true}, knight:{role:'pike',armor:true,elite:true,mounted:true},
  priest:{role:'priest'}, summoner:{role:'mage'}, witch:{role:'witch'},
  emberRavager:{role:'axe',armor:true,ember:true}, cinderRunner:{role:'sword',ember:true},
  sparkArcher:{role:'bow',ember:true}, emberAcolyte:{role:'priest',ember:true},
  ashHexer:{role:'witch',ember:true}, pyreCaller:{role:'mage',ember:true},
  ashChieftain:{role:'axe',armor:true,elite:true,ember:true}, cinderRevenant:{role:'sword',armor:true,elite:true,ember:true},
  mercenary:{role:'sword',armor:true}, contractArcher:{role:'bow'}, fieldMedic:{role:'priest'},
};

export type Shape = 'hound' | 'stag' | 'spider' | 'dragon' | 'stone' | 'ogre' | 'fish' | 'turtle' | 'spirit' | 'wood';
export const creatures: Partial<Record<UnitKind, { shape: Shape; color: string; size?: number; crown?: boolean; weapon?: EquipmentKind }>> = {
  wildling: {shape:'hound',color:'#80735a'}, mossGnawer:{shape:'hound',color:'#666d50'},
  ancientStag:{shape:'stag',color:'#8b7657'},
  spiderling:{shape:'spider',color:'#756e61',size:.7}, venomSpider:{shape:'spider',color:'#60624c'}, spiderQueen:{shape:'spider',color:'#59505a',size:1.17,crown:true},
  dragonWhelp:{shape:'dragon',color:'#a17b5e',size:.8}, redDragon:{shape:'dragon',color:'#8d5445',size:1.17,crown:true},
  golem:{shape:'stone',color:'#747b71',crown:true}, rubbleGolem:{shape:'stone',color:'#a0957f',size:.8}, rockGolem:{shape:'stone',color:'#7d8078'}, graniteGolem:{shape:'stone',color:'#646b70',size:1.17,crown:true},
  stonebackBrute:{shape:'wood',color:'#707360',size:1.12},
  ogreWarrior:{weapon:'club',shape:'ogre',color:'#998875',size:.88}, ogreMage:{weapon:'staff',shape:'ogre',color:'#819195',size:.88}, ogreLord:{weapon:'club',shape:'ogre',color:'#8d8074',size:1.02,crown:true},
  murlocPeon:{weapon:'pike',shape:'fish',color:'#848c70',size:.86}, murlocHunter:{weapon:'javelin',shape:'fish',color:'#72817d'}, tidePriest:{weapon:'staff',shape:'fish',color:'#697d8a',crown:true},
  deepSnapper:{shape:'turtle',color:'#697564'}, spirit:{shape:'spirit',color:'#c5c9b9'},
};

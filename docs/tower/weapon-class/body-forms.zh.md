# 全兵种体态分类（待规则审核）

每一行的体态都显式写在 `catalog.ts::UNIT_RULES` 中；不按名字、半径、武器、雇佣或召唤来源推断。共 55 种：foot 27、mounted 3、beast 9、machine 15、spirit 1。

- foot：双足徒步单位。上塔还要满足存活、非机械、陆军、未在甲板/舱内、自己的塔、人口和全身尺寸排布等条件。
- mounted：骑乘单位；knight、raider、horseArcher。lancer 是长矛步兵，归 foot。
- beast：兽形、多足动物和龙。
- machine：机械、构造体和船。即使外形双足的魔像也不能上塔。
- spirit：当前无足的灵体，独立列出，不归野兽或徒步。

雇佣和召唤是来源，不是体态：mercenary、contractArcher、fieldMedic 都是 foot；召唤出的 foot 单位仍可上塔，spirit 即使永久存在也不能上塔。无人口的徒步单位上塔按 1 人口计。

`UnitVariantDef.bodyForm` 可以显式覆盖；旧存档的 variant 缺该字段时继承基础兵种明确声明的体态。只改 `unitClass` 不会自动改形态，机械 targeting class 的单位仍被拒绝；例如将机械魔像变成可上塔的双足生物，需要同时声明 `unitClass:'nonMechanical', bodyForm:'foot'`。

| kind | 中文名 | bodyForm | 上塔资格 | 边界说明 |
| --- | --- | --- | --- | --- |
| worker | 农民 | foot | 可以 | 工人也是徒步单位。 |
| footman | 步兵 | foot | 可以 |  |
| archer | 弓箭手 | foot | 可以 |  |
| horseArcher | 骑射手 | mounted | 拒绝 |  |
| raider | 掠袭者 | mounted | 拒绝 |  |
| lancer | 长枪兵 | foot | 可以 | 长矛步兵；按总指挥更正归 foot。 |
| ashWarden | 灰烬守卫 | foot | 可以 |  |
| emberRavager | 余烬劫掠者 | foot | 可以 |  |
| cinderRunner | 余火奔袭者 | foot | 可以 |  |
| sparkArcher | 火花弓手 | foot | 可以 |  |
| ashHexer | 灰烬巫师 | foot | 可以 |  |
| knight | 骑士 | mounted | 拒绝 |  |
| priest | 牧师 | foot | 可以 |  |
| summoner | 召唤师 | foot | 可以 | 徒步施法者；与其召出的灵体分开分类。 |
| witch | 女巫 | foot | 可以 |  |
| golem | 魔像 | machine | 拒绝 | 双足机械构造体，仍按 machine 拒绝。 |
| ashChieftain | 灰烬酋长 | foot | 可以 |  |
| cinderRevenant | 余烬复生者 | foot | 可以 | 双足亡灵仍是 foot。 |
| spirit | 灵体 | spirit | 拒绝 | 无足灵体，不能因是召唤物而视为徒步。 |
| mercenary | 雇佣兵 | foot | 可以 | 永久雇佣的双足战士。 |
| contractArcher | 契约弓手 | foot | 可以 | 永久雇佣的徒步弓手。 |
| fieldMedic | 战地医师 | foot | 可以 | 永久雇佣的徒步医师。 |
| wildling | 林间野人 | foot | 可以 |  |
| mossGnawer | 苔鼠 | beast | 拒绝 |  |
| thornSlinger | 荆刺射手 | foot | 可以 |  |
| barkMender | 树皮医者 | foot | 可以 |  |
| stonebackBrute | 石背蛮兽 | beast | 拒绝 |  |
| gladeWitch | 林间女巫 | foot | 可以 |  |
| transport | 运输船 | machine | 拒绝 |  |
| warship | 战船 | machine | 拒绝 |  |
| shipOfTheLine | 重型舷炮舰 | machine | 拒绝 |  |
| cutter | 巡海快艇 | machine | 拒绝 |  |
| bombardShip | 臼炮舰 | machine | 拒绝 |  |
| fireShip | 焚潮舰 | machine | 拒绝 |  |
| carrier | 远洋运兵舰 | machine | 拒绝 |  |
| siegeRam | 铁甲冲车 | machine | 拒绝 |  |
| ballista | 床弩 | machine | 拒绝 |  |
| catapult | 重型投石机 | machine | 拒绝 |  |
| organGun | 连弩炮车 | machine | 拒绝 |  |
| ancientStag | 远古巨鹿 | beast | 拒绝 |  |
| murlocPeon | 鱼人苦工 | foot | 可以 | 双足鱼人。 |
| murlocHunter | 鱼人猎手 | foot | 可以 | 双足鱼人。 |
| tidePriest | 潮汐祭司 | foot | 可以 | 双足鱼人施法者。 |
| deepSnapper | 深渊巨鳌 | beast | 拒绝 |  |
| rubbleGolem | 碎石魔像 | machine | 拒绝 |  |
| rockGolem | 岩石魔像 | machine | 拒绝 |  |
| graniteGolem | 花岗岩魔像 | machine | 拒绝 |  |
| ogreWarrior | 食人魔战士 | foot | 可以 | 双足食人魔；体型仍需排布校验。 |
| ogreMage | 食人魔法师 | foot | 可以 | 双足食人魔施法者。 |
| ogreLord | 食人魔领主 | foot | 可以 | 最大基础 foot 体型（半径 28），仍需排布校验。 |
| spiderling | 小蜘蛛 | beast | 拒绝 |  |
| venomSpider | 毒蛛 | beast | 拒绝 |  |
| spiderQueen | 蛛后 | beast | 拒绝 |  |
| dragonWhelp | 幼龙 | beast | 拒绝 |  |
| redDragon | 红龙 | beast | 拒绝 |  |

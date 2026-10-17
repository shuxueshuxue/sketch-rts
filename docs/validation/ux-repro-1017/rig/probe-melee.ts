// A melee unit ringed by 2-4 harmless foes, charge off: every tick it lands a blow is logged with its target and clock.
// Variants: foes that die to one or two blows (retarget), idle auto-acquire, attack order, attack-move, hold.
import { createGame, issueCommand, stepGame } from "./src/shared/sim";
import { UNIT_DEFS } from "./src/shared/catalog";

const rows: string[] = [];
for (const kind of ["knight", "footman", "raider", "lancer", "ashWarden"] as const) {
  for (const ring of [2, 3, 4]) for (const foeHp of [15, 40, 400]) for (const order of ["idle", "attack", "attackMove", "hold"] as const) {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
    game.units = [];
    const unit = game.spawnUnit("player", kind, 1000, 1000);
    issueCommand(game, { type: "setAutocast", unitIds: [unit.id], ability: "charge", enabled: false });
    const foes = Array.from({ length: ring }, (_, i) => {
      const angle = (i / ring) * Math.PI * 2;
      const gap = unit.radius + UNIT_DEFS.footman.radius + 4;
      const foe = game.spawnUnit("enemy", "footman", 1000 + Math.cos(angle) * gap, 1000 + Math.sin(angle) * gap);
      foe.hp = Math.min(foeHp, foe.maxHp); foe.attackDamage = 0;
      return foe;
    });
    if (order === "attack") issueCommand(game, { type: "attack", unitIds: [unit.id], targetId: foes[0]!.id });
    if (order === "attackMove") issueCommand(game, { type: "attackMove", unitIds: [unit.id], x: 1400, y: 1000 });
    if (order === "hold") issueCommand(game, { type: "holdPosition", unitIds: [unit.id] });
    const blows: { tick: number; on: string[]; cd: number; order: string }[] = [];
    for (let t = 0; t < 300; t++) {
      const before = foes.map(f => f.hp);
      const alive = foes.map(f => game.units.includes(f));
      stepGame(game);
      const hit = foes.filter((f, i) => f.hp < before[i]! || (alive[i] && !game.units.includes(f) && before[i]! > 0));
      if (hit.length) blows.push({ tick: game.tick, on: hit.map(f => f.id.slice(-3)), cd: unit.cooldown, order: unit.order.type });
    }
    const gaps = blows.slice(1).map((b, i) => b.tick - blows[i]!.tick);
    const min = gaps.length ? Math.min(...gaps) : Infinity;
    const multi = blows.filter(b => b.on.length > 1).length;
    if (min < unit.attackCooldown || multi) rows.push(`${kind} ring${ring} hp${foeHp} ${order}: cd ${unit.attackCooldown} minGap ${min} multiTargetBlows ${multi} :: ${blows.slice(0, 8).map(b => `${b.tick}[${b.on}]cd${b.cd}${b.order[0]}`).join(" ")}`);
  }
}
console.log(rows.length ? rows.join("\n") : "no blow ever came sooner than its unit's cooldown, and none struck two foes");

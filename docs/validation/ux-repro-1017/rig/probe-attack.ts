// A rider beside one enemy with a second enemy 180–300 away: log every hit it lands (tick, target, gap since its last hit).
import { createGame, stepGame } from "../repo/src/shared/sim";
import { createUnit } from "../repo/src/shared/map";
import { UNIT_DEFS } from "../repo/src/shared/catalog";

for (const kind of ["knight", "raider", "footman", "archer", "horseArcher"] as const) {
  for (const firstHp of [20, 300]) {
    const game = createGame("combatArena", { aiPlayers: [] });
    game.units = [];
    const rider = createUnit("rider", "player", kind, 800, 800);
    const a = createUnit("a", "enemy", "footman", 800 + rider.radius + 20 + 2, 800); a.hp = Math.min(firstHp, a.maxHp);
    const b = createUnit("b", "enemy", "footman", 800, 800 + 240);
    for (const enemy of [a, b]) { enemy.attackDamage = 0; }
    game.units.push(rider, a, b);
    const last = new Map<string, number>();
    const hits: string[] = [];
    let prevHit: number | undefined, minGap = Infinity;
    for (let t = 0; t < 400; t++) {
      for (const u of [a, b]) last.set(u.id, u.hp);
      stepGame(game, 1);
      for (const u of [a, b]) {
        const before = last.get(u.id)!;
        if (u.hp < before || (before > 0 && !game.units.includes(u))) {
          if (prevHit !== undefined) minGap = Math.min(minGap, game.tick - prevHit);
          hits.push(`${game.tick}:${u.id}${prevHit !== undefined ? "+" + (game.tick - prevHit) : ""}(${rider.order.type})`);
          prevHit = game.tick;
        }
      }
    }
    console.log(kind.padEnd(11), `A hp ${String(firstHp).padEnd(3)} cooldown ${UNIT_DEFS[kind].attackCooldown} minGap ${minGap}`, minGap < UNIT_DEFS[kind].attackCooldown ? "<<< FASTER THAN COOLDOWN" : "", hits.slice(0, 7).join(" "));
  }
}

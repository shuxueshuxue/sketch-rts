// The ring of foes again, now through the client's UnitAnimationTracker: sample the drawn pose at 60 fps and count the
// swings a player would see against the blows the sim landed.
import { createGame, issueCommand, snapshotGame, stepGame } from "./src/shared/sim";
import { UNIT_DEFS } from "./src/shared/catalog";
import { UnitAnimationTracker } from "./src/client/unit-animation";

for (const kind of ["knight", "footman"] as const) for (const ring of [1, 2, 4]) for (const foeHp of [40, 400]) for (const every of [1, 2, 3]) {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  const unit = game.spawnUnit("player", kind, 1000, 1000); unit.hp = unit.maxHp = 5000;
  issueCommand(game, { type: "setAutocast", unitIds: [unit.id], ability: "charge", enabled: false });
  const foes = Array.from({ length: ring }, (_, i) => {
    const a = (i / ring) * Math.PI * 2, gap = unit.radius + UNIT_DEFS.footman.radius + 4;
    const foe = game.spawnUnit("enemy", "footman", 1000 + Math.cos(a) * gap, 1000 + Math.sin(a) * gap); foe.hp = Math.min(foeHp, foe.maxHp); return foe;
  });
  const tracker = new UnitAnimationTracker();
  let blows = 0, swings = 0, lastKey = "", now = 0;
  const swingTicks: number[] = [], blowTicks: number[] = [];
  for (let t = 0; t < 400; t++) {
    const before = foes.map(f => f.hp);
    stepGame(game);
    if (foes.some((f, i) => f.hp < before[i]!)) { blows++; blowTicks.push(game.tick); }
    now += 50;
    if (game.tick % every === 0) tracker.update(snapshotGame(game), now);
    for (let s = 0; s < 3; s++) {
      const frame = tracker.frame(unit, now + s * 16.7);
      const key = frame.mode === "attack" ? `a${frame.frame}` : "x";
      // a swing starts on its first attack frame after any other pose, or when the attack frames restart
      if (frame.mode === "attack" && (lastKey === "x" || Number(lastKey.slice(1)) > frame.frame)) { swings++; swingTicks.push(game.tick); }
      lastKey = key;
    }
  }
  const flag = swings !== blows ? "  <<< MISMATCH" : "";
  console.log(`${kind} ring${ring} hp${foeHp} snapshot/${every}: blows ${blows} swings ${swings}${flag}${flag ? "  blows@" + blowTicks.slice(0, 8) + " swings@" + swingTicks.slice(0, 10) : ""}`);
}

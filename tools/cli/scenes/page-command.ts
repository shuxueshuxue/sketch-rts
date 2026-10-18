// A command sent by the page (as the player, through its socket) in a paused room lands when the scene ticks the room
// (see @@@api-tick-queue): before, the page said it was done and the world never heard of it.
import type { Scene } from "../drivers/browser";
type Snap = { tick: number; units: { id: string; owner: string; kind: string; x: number; y: number; order: { type: string } }[] };
export default async function (s: Scene) {
  await s.room("pineshade");
  // No computers: the API's tick waits for every AI think, which a busy host can take too long over.
  await s.scenario({ aiPlayers: [] });
  const start = await s.snapshot() as Snap;
  const worker = start.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
  await s.select([worker.id]);
  const sent = await s.command({ type: "move", unitIds: [worker.id], x: worker.x + 160, y: worker.y } as never);
  await s.wait(1500);
  await s.tick(60);
  const end = await s.snapshot() as Snap, after = end.units.find((unit) => unit.id === worker.id)!;
  const sync = await s.api(`/api/rooms/${s.roomId}/sync-events`) as { summary: unknown; events: unknown[] };
  const moved = Math.round(Math.hypot(after.x - worker.x, after.y - worker.y));
  s.must(moved > 30, `sent ${sent}; ticks ${start.tick}->${end.tick}; moved ${moved}, order ${after.order.type}; sync ${JSON.stringify(sync.summary)} ${JSON.stringify(sync.events.slice(-3)).slice(0, 600)}`);
}

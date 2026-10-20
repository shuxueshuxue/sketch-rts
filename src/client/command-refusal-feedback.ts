import type { CommandRefusal } from '../shared/command-refusal';
import type { PlayerId, WorldEffect } from '../shared/types';
import { shouldRenderCommandFeedback } from './command-feedback';

export type RefusalNotice = { owner: PlayerId; refusal: CommandRefusal; count: number; status: 'waiting' | 'rejected'; sound: boolean };

/** UI memory only. Receipt IDs suppress repeated snapshots, while waiting is keyed by state entry, not elapsed ticks. */
export class CommandRefusalFeedback {
  private seen = new Set<string>();
  private waiting = new Set<string>();
  private sounded = new Map<string, number>();

  consume(effects: readonly WorldEffect[], viewer: PlayerId | undefined, now: number): RefusalNotice[] {
    const activeWaiting = new Set<string>();
    const groups = new Map<string, RefusalNotice>();
    for (const effect of effects) {
      if (effect.type !== 'orderEnded' || !effect.refusal || !effect.owner || !shouldRenderCommandFeedback(effect, viewer)) continue;
      const status = effect.feedbackStatus ?? 'rejected';
      if (status === 'waiting') activeWaiting.add(effect.id);
      if (status === 'waiting' ? this.waiting.has(effect.id) : this.seen.has(effect.id)) continue;
      if (status !== 'waiting') this.seen.add(effect.id);
      const key = `${effect.owner}:${effect.refusal.reason}:${status}`;
      const group = groups.get(key);
      if (group) {
        group.count += 1;
        // Keep the largest actual shortfall/countdown when a selection has different numeric blockers.
        if (effect.refusal.reason === 'gold' && group.refusal.reason === 'gold' && effect.refusal.detail.required - effect.refusal.detail.available > group.refusal.detail.required - group.refusal.detail.available) group.refusal = effect.refusal;
        if (effect.refusal.reason === 'cooldown' && group.refusal.reason === 'cooldown' && effect.refusal.detail.remainingTicks > group.refusal.detail.remainingTicks) group.refusal = effect.refusal;
      } else groups.set(key, this.reject(effect.refusal, effect.owner, now, 1, status));
    }
    this.waiting = activeWaiting;
    if (this.seen.size > 2048) this.seen = new Set([...this.seen].slice(-1024));
    return [...groups.values()];
  }

  reject(refusal: CommandRefusal, owner: PlayerId, now: number, count = 1, status: 'waiting' | 'rejected' = 'rejected'): RefusalNotice {
    const key = `${owner}:${refusal.reason}`;
    const sound = status === 'rejected' && now - (this.sounded.get(key) ?? -Infinity) >= 1000;
    if (sound) this.sounded.set(key, now);
    return { owner, refusal, count, status, sound };
  }

  reset() { this.seen.clear(); this.waiting.clear(); this.sounded.clear(); }
}

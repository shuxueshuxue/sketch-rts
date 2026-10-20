import { expect, it } from 'vitest';
import { CommandRefusalFeedback } from './command-refusal-feedback';
import { commandRefusalText } from './command-refusal-text';
import type { WorldEffect } from '../shared/types';

const effect = (id: string, owner = 'player', waiting = false): WorldEffect => ({
  id, type: 'orderEnded', owner, x: 1, y: 1, remaining: 10, duration: 10, feedbackStatus: waiting ? 'waiting' : 'rejected',
  refusal: { reason: 'gold', detail: { required: 100, available: 20 } },
});

it('merges equal reasons and keeps text and sound private to the issuer, including allied and spectator views', () => {
  const feedback = new CommandRefusalFeedback();
  const notices = feedback.consume([effect('a'), effect('b'), effect('other', 'enemy')], 'player', 0);
  expect(notices).toHaveLength(1); expect(notices[0]).toMatchObject({ count: 2, sound: true });
  expect(commandRefusalText(notices[0]!.refusal)).toBe('金币不足，还差 80');
  expect(feedback.consume([effect('a'), effect('b')], 'player', 10)).toEqual([]);
  for (const viewer of [undefined, 'spectator', 'ally']) expect(new CommandRefusalFeedback().consume([effect('private')], viewer, 0)).toEqual([]);
});

it('throttles audio per owner and reason for one second without dropping subsequent text', () => {
  const feedback = new CommandRefusalFeedback();
  expect(feedback.consume([effect('a')], 'player', 0)[0]?.sound).toBe(true);
  expect(feedback.consume([effect('b')], 'player', 999)[0]).toMatchObject({ sound: false, count: 1 });
  expect(feedback.consume([effect('c')], 'player', 1000)[0]?.sound).toBe(true);
  expect(feedback.reject({ reason: 'inventory-full', detail: { unitId: 'unit' } }, 'player', 1000).sound).toBe(true);
});

it('announces waiting only on state entry, silently, and again after a real exit and reentry', () => {
  const feedback = new CommandRefusalFeedback();
  expect(feedback.consume([effect('waiting', 'player', true)], 'player', 0)[0]).toMatchObject({ status: 'waiting', sound: false });
  expect(feedback.consume([effect('waiting', 'player', true)], 'player', 10000)).toEqual([]);
  feedback.consume([], 'player', 10001);
  expect(feedback.consume([effect('waiting', 'player', true)], 'player', 10002)).toHaveLength(1);
});

it('formats infantry-only tower refusals from shared facts for mounted, beast and spirit bodies', () => {
  for (const bodyForm of ['mounted', 'beast', 'spirit'] as const) {
    expect(commandRefusalText({ reason: 'garrison-not-infantry', detail: { buildingId: 'tower', bodyForm } }))
      .toBe('只有徒步单位能登上防御塔');
  }
});

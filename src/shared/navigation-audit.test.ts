import { expect, it } from 'vitest';
import { recordNativeRouting, withFactNavigation, withNavigationAudit, withNavigationPhase, type NavigationAuditEvent } from './navigation-audit';
import { steerPoint, guardedField, walkDestination } from './terrain';
import { groundApproachRoute, groundSteeringRoute } from './route-selection';

it('scopes diagnostic authorization and phase through exceptions without changing ordinary routing', () => {
  const events: NavigationAuditEvent[] = [];
  withNavigationAudit(event => events.push(event), () => {
    withNavigationPhase('strategy-planning', () => {
      recordNativeRouting('unmetered');
      expect(() => withFactNavigation({ kind: 'fact-work', throughWork: 5 }, () => {
        recordNativeRouting('budgeted'); throw new Error('exit');
      })).toThrow('exit');
      recordNativeRouting('unmetered-again');
    });
    recordNativeRouting('outside-planning');
  });
  expect(events).toEqual([
    { operation: 'unmetered', phase: 'strategy-planning', authorization: null },
    { operation: 'budgeted', phase: 'strategy-planning', authorization: { kind: 'fact-work', throughWork: 5 } },
    { operation: 'unmetered-again', phase: 'strategy-planning', authorization: null },
    { operation: 'outside-planning', phase: null, authorization: null },
  ]);
  recordNativeRouting('ordinary'); expect(events).toHaveLength(4);
});

it('guards routing entry points before open-ground, direct-road or warm-cache shortcuts', () => {
  const map = { width: 1280, height: 1280, terrain: { cell: 32, cols: 40, rows: 40, cells: '.'.repeat(1600) } };
  const from = { x: 336, y: 336 }, goal = { x: 496, y: 336 };
  const cases = { walkDestination: () => walkDestination(map, from, goal), steerPoint: () => steerPoint(map, from, goal),
    groundApproachRoute: () => groundApproachRoute(map, from, goal), groundSteeringRoute: () => groundSteeringRoute(map, from, goal),
    guardedField: () => guardedField(map, from, []) };
  const guard = (event: NavigationAuditEvent) => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw new Error(`Unmetered ${event.operation}`);
  };
  for (const [name, run] of Object.entries(cases)) {
    for (let pass = 0; pass < 2; pass++) {
      expect(() => withNavigationAudit(guard, () => withNavigationPhase('strategy-planning', () => { run(); }))).toThrow(`Unmetered ${name}`);
      expect(() => run()).not.toThrow();
    }
  }
});

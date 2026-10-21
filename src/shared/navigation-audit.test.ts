import { expect, it } from 'vitest';
import { recordNativeRouting, withFactNavigation, withNavigationAudit, withNavigationPhase, type NavigationAuditEvent } from './navigation-audit';

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

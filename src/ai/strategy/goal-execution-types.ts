import type { GoalActionKind, GoalExecutorBinding } from './goal-planner-types';
import type { TrainableUnitKind } from '../../shared/types';

/** A training job settles quantity into the mover-region pool, never an
 * entity identity. Cancellation removes its forecast inflow permanently. */
export type GoalTrainingQuery = Readonly<{ acceptedCommandId: string; producerId: string;
  jobId: string; unitKind: TrainableUnitKind }>;
export type GoalTrainingObservation = GoalTrainingQuery & Readonly<{
  state: 'pending' | 'training' | 'cancelled' | 'fulfilled';
  observedTick: number; creditedQuantity: 0 | 1; reasonCode: string;
}>;
export type GoalTrainingReader = (query: GoalTrainingQuery) => GoalTrainingObservation;

/** Ready-action bridge payload. All existing/output/binding references have
 * been resolved against actual entity receipts before this intent is leased.
 * Executors still command only the existing ActionGrant's real resources. */
export type GoalExecutableIntent = Readonly<{
  kind: 'goal-action'; goalId: string; declarationId: string; actionKind: GoalActionKind;
  parameters: GoalExecutorBinding['parameters']; outputs: readonly string[];
}>;

/** Proposals, validated centrally against the native queue/foundation,
 * accepted-command baseline and unique observed real entity. A paid command
 * or an elapsed estimate alone cannot bind an output to a world ID. */
export type GoalOutputReceipt = Readonly<{
  output: string; entityId: string; observedTick: number;
  proof: Readonly<{ kind: 'foundation'; acceptedCommandId: string }>
    | Readonly<{ kind: 'birth'; acceptedCommandId: string; producerId: string; jobId: string }>;
}>;

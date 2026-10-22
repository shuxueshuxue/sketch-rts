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
  /** Persisted intents keep an empty parameter record plus this exact
   * definition version. Only the execution boundary expands it. */
  parametersRef?: string;
}>;

/** Only buildings have individual outputs. Training uses the quantity/job
 * reader above and never proposes or binds the identity of a born unit. */
export type GoalOutputReceipt = Readonly<{
  output: string; entityId: string; observedTick: number;
  proof: Readonly<{ kind: 'foundation'; acceptedCommandId: string }>;
}>;

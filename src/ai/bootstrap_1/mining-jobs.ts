import type { Unit } from '../../shared/types';

/** A queued return to mining keeps the job while its worker takes shelter. */
export function miningJobOrder(worker: Unit) {
  if (worker.order.type === 'mine') return worker.order;
  if (worker.order.type === 'move') return worker.orderQueue?.find(order => order.type === 'mine');
}

import { variant } from './art-card-bank-variant.js';
await import('./art-viewport-fixture.js');
const cycle = window.viewportReview.cycle;
window.viewportReview.cycle = async function (...args) {
  const result = await cycle.apply(this, args);
  result.variant = variant;
  result.variantSetups = [...window.cardBankReview.setups];
  return result;
};

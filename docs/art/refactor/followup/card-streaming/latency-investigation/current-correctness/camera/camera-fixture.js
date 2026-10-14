import { variant } from './art-card-bank-variant.js';
await import('./art-card-mip-camera-fixture.js');
const init = window.mipCameraReview.init;
window.mipCameraReview.init = async function (...args) {
  const result = await init.apply(this, args);
  result.variant = variant;
  result.variantSetups = [...window.cardBankReview.setups];
  return result;
};

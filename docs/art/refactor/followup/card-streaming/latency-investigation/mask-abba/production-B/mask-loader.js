// Balanced untimed module preparation, not a production fallback. No functions are called.
const baselineRoot=__CARD_MASK_BASELINE_SOURCE_ROOT__,sourceRoot=__BENCHMARK_SOURCE_ROOT__,policy=__CARD_MASK_POLICY__;
const baseline=await import(/* @vite-ignore */ '/@fs'+baselineRoot+'/src/client/world3d/card-pick-mask.ts');
const current=await import(/* @vite-ignore */ '/@fs'+sourceRoot+'/src/client/world3d/card-pick-mask.ts');
if(typeof baseline.packCardPickMask!=='function'||typeof current.packCardPickMask!=='function')throw new Error('Mask module exports unavailable');
if(baseline.cardMaskHit.toString()!==current.cardMaskHit.toString())throw new Error('Public cardMaskHit implementation changed: this comparison must isolate packing');
window.cardMaskFormal={ready:true,policy,peakPolicy:'current production, untouched',
 providerRoot:policy==='original'?baselineRoot:sourceRoot,providerFile:'src/client/world3d/card-pick-mask.ts',
 baselineModuleImportedWithoutCalling:true,currentModuleImportedWithoutCalling:true,publicCardMaskHitFunctionSourceIdentical:true,
 setup:'Vite pre-resolve override only for the current PaintedCardBatches import of ./card-pick-mask; no instance or per-frame monkey patch.'};

// Balanced module preparation. Neither external class is instantiated here.
const baselineRoot=__CARD_RLE_BASELINE_SOURCE_ROOT__,candidatePath=__CARD_RLE_CANDIDATE_SOURCE__,policy=__CARD_RLE_POLICY__;
const baseline=await import(/* @vite-ignore */ '/@fs'+baselineRoot+'/src/client/world3d/card-raster-cache.ts');
const candidate=await import(/* @vite-ignore */ '/@fs'+candidatePath);
for(const module of [baseline,candidate]){
 if(typeof module.CardRasterCache!=='function')throw new Error('Complete CardRasterCache class export required');
 for(const method of ['get','put','clear','stats'])if(typeof module.CardRasterCache.prototype[method]!=='function')throw new Error('Cache interface missing '+method);
}
window.cardRleFormal={ready:true,policy,peakPolicy:'current production, untouched',maskPolicy:'current production, untouched',
 providerPath:policy==='original'?baselineRoot+'/src/client/world3d/card-raster-cache.ts':candidatePath,
 baselineModuleImportedWithoutInstantiation:true,candidateModuleImportedWithoutInstantiation:true,
 setup:'Vite pre-resolve selects the complete class module only for the current PaintedCardBatches ./card-raster-cache import. No get-only override, instance monkey patch or per-frame observer.'};

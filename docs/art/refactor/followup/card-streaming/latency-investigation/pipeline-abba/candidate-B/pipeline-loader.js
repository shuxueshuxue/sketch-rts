
const baselineRoot=__CARD_RLE_BASELINE_SOURCE_ROOT__,sourceRoot=__BENCHMARK_SOURCE_ROOT__;
const oldMask=await import(/* @vite-ignore */ '/@fs'+baselineRoot+'/src/client/world3d/card-pick-mask.ts');
const newMask=await import(/* @vite-ignore */ '/@fs'+sourceRoot+'/src/client/world3d/card-pick-mask.ts');
if(oldMask.cardMaskHit.toString()!==newMask.cardMaskHit.toString())throw new Error('Public mask picking function changed');
/** Same-current-source statistics-policy ablation. Imported after the existing
 * bank fixture and metadata helper, before World3DLayer.create. This fixture
 * override is not a production compatibility/fallback path or timing profiler.
 */
const policy=__CARD_RLE_POLICY__==='original'?'original':'production';


if(!['original','production'].includes(policy)||!sourceRoot||!baselineRoot)throw new Error('Explicit latency policy/source roots required');
if(window.cardLatencyVariant)throw new Error('Latency policy already installed');
const {World3DLayer}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/world-layer.ts`);
// Import for both policies before preparation. Never instantiate the baseline
// class or create any baseline renderer, texture, canvas or other resource.
const {PaintedCardBatches:Baseline}=await import(/* @vite-ignore */ `/@fs${baselineRoot}/src/client/world3d/painted-card-batches.ts`);
const baselineStats=Baseline.prototype.stats,baselinePeaks=Baseline.prototype.recordPeaks;
if(typeof baselineStats!=='function'||typeof baselinePeaks!=='function')throw new Error('Frozen baseline methods are unavailable');
const provider=policy==='original'?baselineRoot:sourceRoot;
const description={policy,methodProviderRoot:provider,methodProviderFile:'src/client/world3d/painted-card-batches.ts',
  methods:['stats','recordPeaks'],methodNames:{stats:baselineStats.name,recordPeaks:baselinePeaks.name},
  setup:'Current World3DLayer.create runs first, including existing bank/native-mip setup. Only original policy assigns the two frozen baseline method references to current cards/remainsCards instances before preparation/first draw.',
  productionMethodsUnmodified:policy==='production',baselineClassInstantiated:false,
  scope:'Same-current-source statistical peak-accounting policy ablation. Art, raster, transfer, allocation, order and all other methods remain current production. No per-draw timing observer or new render call.'};
const setups=[];
const originalCreate=World3DLayer.create;
World3DLayer.create=function(...args){
  const layer=originalCreate.apply(this,args);
  const instances=[];
  for(const [name,batch] of [['cards',layer.cards],['remainsCards',layer.remainsCards]]){
    if(batch.pages.length||batch.chunks.length||batch.cards.size)throw new Error('Statistics override installed after first resources');
    const currentStats=batch.stats,currentPeaks=batch.recordPeaks;
    if(policy==='original'){
      batch.stats=baselineStats;
      batch.recordPeaks=baselinePeaks; // Its this.stats() resolves to baselineStats.
    }
    if(policy==='original'&&(batch.stats!==baselineStats||batch.recordPeaks!==baselinePeaks))throw new Error('Baseline binding failed');
    if(policy==='production'&&(batch.stats!==currentStats||batch.recordPeaks!==currentPeaks))throw new Error('Production methods changed');
    instances.push({name,maxBanks:batch.maxTextureBanks,pages:batch.pages.length,chunks:batch.chunks.length,
      statsProvider:provider,recordPeaksProvider:provider,statsName:batch.stats.name,recordPeaksName:batch.recordPeaks.name,
      exactBaselineMethodReferences:policy==='original',noOverride:policy==='production'});
  }
  setups.push({policy,instances,outsideDraw:true,residentMipSource:layer.residentMip.toString()});
  return layer;
};
window.cardLatencyVariant={installed:true,description,drainSetups(){return setups.splice(0);}};

const {PaintedCardBatches:Current}=await import(/* @vite-ignore */ '/@fs'+sourceRoot+'/src/client/world3d/painted-card-batches.ts');
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
window.pipelineMethods={};
for(const [name,Class] of [['baseline',Baseline],['current',Current]]){
 window.pipelineMethods[name]={};
 for(const key of ['stats','recordPeaks']){const source=Class.prototype[key].toString();window.pipelineMethods[name][key]={name:Class.prototype[key].name,source,sha256:await sha(source)};}
}

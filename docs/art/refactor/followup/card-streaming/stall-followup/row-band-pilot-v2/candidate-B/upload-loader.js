// Balanced module imports. Neither uploader class nor texture factory is invoked.
const originalPath=__CARD_UPLOAD_ORIGINAL_SOURCE__,candidatePath=__CARD_UPLOAD_CANDIDATE_SOURCE__,policy=__CARD_UPLOAD_POLICY__;
const baseline=await import(/* @vite-ignore */ '/@fs'+originalPath);
const candidate=await import(/* @vite-ignore */ '/@fs'+candidatePath);
for(const module of [baseline,candidate]){
 for(const name of ['CardMipUploader','createCardArray','cardTextureBytes'])if(typeof module[name]!=='function')throw new Error('Uploader module export missing '+name);
 for(const method of ['uploadLayer','copyLayers','stats','dispose','releaseSize'])if(typeof module.CardMipUploader.prototype[method]!=='function')throw new Error('Uploader interface missing '+method);
}
window.cardUploadFormal={ready:true,policy,peakPolicy:'current production, untouched',maskPolicy:'current production, untouched',cachePolicy:'current production, untouched',
 providerPath:policy==='original'?originalPath:candidatePath,
 baselineModuleImportedWithoutInstantiation:true,candidateModuleImportedWithoutInstantiation:true,textureFactoriesCalledBySetup:false,
 setup:'Vite pre-resolve selects the complete uploader module only for current PaintedCardBatches ./card-mip-uploader. Provider region imports resolve to frozen current region bytes; external three resolves through the current source package. No instance/per-call monkey patch.'};

// Installed after fixture imports, before any WorldPresentation is created.
// The frozen fact fixtures call cardStats only after their measured samples
// and after each camera probe's elapsed values have already been captured.
const {World3DLayer}=await import(/* @vite-ignore */ `/@fs${__BENCHMARK_SOURCE_ROOT__}/src/client/world3d/world-layer.ts`);
const original=World3DLayer.prototype.cardStats;
const countBy=values=>{const result={};for(const value of values)result[value]=(result[value]??0)+1;return result;};
function residentSnapshot(cards){
 const entries=[...cards.cards.values()];
 const pages=cards.pages.map((page,index)=>({index,width:page.texture.image.width,height:page.texture.image.height,capacity:page.texture.image.depth,uploaded:page.uploaded,
  liveLayers:page.cards.filter(Boolean).length,activeLayers:page.cards.filter(card=>card?.used===cards.frame).length,
  actualBaseMips:countBy(page.cards.filter(Boolean).map(card=>card.baseMip)),originalSourceSizes:countBy(page.cards.filter(Boolean).map(card=>card.sourceSize))}));
 const chunks=cards.chunks.map((chunk,index)=>({index,visible:chunk.mesh.visible,count:chunk.mesh.count,capacity:chunk.capacity,banks:chunk.pages.length,
  renderOrder:chunk.mesh.renderOrder,bankPages:chunk.pages.map(page=>pages[cards.pages.indexOf(page)]?.index??null)}));
 return{outsideMeasuredTimers:true,actualCardBaseMips:countBy(entries.map(card=>card.baseMip)),originalSourceSizes:countBy(entries.map(card=>card.sourceSize)),
  activeCardBaseMips:countBy(entries.filter(card=>card.used===cards.frame).map(card=>card.baseMip)),
  totalPageCapacity:pages.reduce((sum,page)=>sum+page.capacity,0),liveLayers:pages.reduce((sum,page)=>sum+page.liveLayers,0),
  activeLayers:pages.reduce((sum,page)=>sum+page.activeLayers,0),pages,chunks};
}
World3DLayer.prototype.cardStats=function(){return{...original.call(this),residencySnapshot:residentSnapshot(this.cards)};};
window.cardBankPerformanceMetadata={installed:true,scope:'Untimed cardStats counter calls only; no per-draw hook or observer. Actual cards/pages/chunks are read after samples, never inferred from requested mip classifications.'};

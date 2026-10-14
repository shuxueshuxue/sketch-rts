// Browser-only observer for the three-pixel mixed-scene failure. This changes
// diagnostic buffer ordering only; no production source or simulation is edited.
const source = '/@fs' + (typeof __BENCHMARK_SOURCE_ROOT__ !== 'undefined' ? __BENCHMARK_SOURCE_ROOT__ : window.__CARD_ORDER_SOURCE_ROOT__);
const { World3DLayer } = await import(/* @vite-ignore */ `${source}/src/client/world3d/world-layer.ts`);
const watched = ['unit-player-spiderQueen-1011', 'unit-player-redDragon-1012'];
export function installCardOrderDiagnostic(mode = 'observe') {
  const originalDraw = World3DLayer.prototype.draw;
  window.cardOrderDiagnostic = [];
  World3DLayer.prototype.draw = function (frame) {
    const cards = this.cards, originalFinish = cards.finish;
    const desired = new Map(frame.snapshot.units.map((unit, index) => [unit.id, index]));
    let observed;
    cards.finish = function (renderer) {
      const result = originalFinish.call(this, renderer);
      const describe = () => this.pages.filter(page => watched.some(id => page.ids.includes(id))).map(page => ({
        materialId: page.material.id, meshId: page.mesh?.id, renderOrder: page.mesh?.renderOrder,
        sourceWidth: page.texture.image.width, sourceHeight: page.texture.image.height, depth: page.texture.image.depth,
        ids: [...page.ids], instanceOrders: [...page.orders],
        watched: watched.map(id => { const index = page.ids.indexOf(id), card = page.entries[index];
          return index < 0 ? null : { id, index, layer: card.layer, key: card.key, sourceSize: card.sourceSize,
            baseMip: card.baseMip, originalUnitOrder: desired.get(id) }; }).filter(Boolean),
      }));
      const before = describe();
      if (mode === 'snapshot-order' || mode === 'snapshot-and-page-order') for (const page of this.pages) {
        if (!page.mesh) continue;
        if (mode === 'snapshot-and-page-order') page.mesh.renderOrder = Math.min(...page.ids.map(id => desired.get(id) ?? Number.MAX_SAFE_INTEGER));
        if (page.ids.length < 2) continue;
        const permutation = page.ids.map((id, index) => ({ index, order: desired.get(id) ?? Number.MAX_SAFE_INTEGER }))
          .sort((a, b) => a.order - b.order || a.index - b.index).map(item => item.index);
        const rearrange = values => { const old = values.slice(); for (let i = 0; i < permutation.length; i++) values[i] = old[permutation[i]]; };
        for (const values of [page.ids, page.entries, page.matrices, page.feet, page.opacities, page.orders]) rearrange(values);
        for (const attribute of [page.mesh.instanceMatrix, ...['cardLayer', 'cardRect', 'cardOpacity'].map(name => page.geometry.getAttribute(name)).filter(Boolean)]) {
          const old = attribute.array.slice(), stride = attribute.itemSize;
          for (let i = 0; i < permutation.length; i++) for (let component = 0; component < stride; component++) {
            attribute.array[i * stride + component] = old[permutation[i] * stride + component];
          }
          attribute.needsUpdate = true;
        }
      }
      observed = { before, after: describe() };
      return result;
    };
    try { return originalDraw.call(this, frame); }
    finally {
      cards.finish = originalFinish;
      if (frame.now >= 491 * 1000 / 60 && observed) window.cardOrderDiagnostic.push({
        mode, tick: frame.snapshot.tick, now: frame.now, view: { ...frame.view }, ...observed,
      });
    }
  };
}
export async function attachReviewDiagnostic(mode) {
  installCardOrderDiagnostic(mode);
  await import('./art-viewport-streaming-fixture.js');
  const cycle = window.viewportReview.cycle;
  window.viewportReview.cycle = async function (...args) {
    window.cardOrderDiagnostic.length = 0;
    const result = await cycle.apply(this, args);
    result.cardOrderDiagnostic = { mode, frames: window.cardOrderDiagnostic, observer: 'art-viewport-card-order-diagnostic.js',
      scope: 'Correctness diagnostic only. Observes physical array page and instance order for first idle spiderQueen/redDragon overlap. snapshot-order mode sorts page instance buffers by original snapshot unit order after normal finish, preserving all values, source pixels, geometry and clocks. Changes diagnostic runtime only; does not measure performance.' };
    return result;
  };
}

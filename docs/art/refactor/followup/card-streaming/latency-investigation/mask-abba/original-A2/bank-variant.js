/** Review configuration applied during World3DLayer.create, before prepare or
 * first draw. No per-frame pose/key traversal and no GPU-private API access. */
const sourceRoot = typeof __BENCHMARK_SOURCE_ROOT__ !== 'undefined' ? __BENCHMARK_SOURCE_ROOT__ : window.__CARD_BANK_SOURCE_ROOT__;
const requested = typeof __CARD_BANK_VARIANT__ !== 'undefined' ? __CARD_BANK_VARIANT__ : window.__CARD_BANK_VARIANT__;
if (!sourceRoot || !requested) throw new Error('A bank review must explicitly specify source and variant');
const maxBanks = Number(requested.maxBanks), mips = requested.mips;
if (!Number.isInteger(maxBanks) || maxBanks < 1 || maxBanks > 8 || !['native', 'full'].includes(mips)) throw new Error('Invalid bank review variant');
export const variant = Object.freeze({ name: requested.name ?? `ordered-bank-${maxBanks}-${mips}`, maxBanks, mips,
  ordering: 'production stable snapshot ordering', referenceOverrides: mips === 'full' ? ['residentMip returns 0'] : [],
  setup: 'World3DLayer.create, before prepare/first draw; cached card and remains maxTextureBanks set directly; no per-frame observer' });
const { World3DLayer } = await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/world-layer.ts`);
const originalCreate = World3DLayer.create;
window.cardBankReview = { variant, setups: [] };
World3DLayer.create = function (...args) {
  const layer = originalCreate.apply(this, args);
  for (const cards of [layer.cards, layer.remainsCards]) {
    if (cards.pages.length || cards.chunks.length) throw new Error('Bank variant setup occurred after resources were drawn');
    cards.maxTextureBanks = maxBanks;
  }
  if (mips === 'full') layer.residentMip = function () { this.cardMipBases[0]++; return 0; };
  window.cardBankReview.setups.push({ maxBanks, mips, cardMaxBanks: layer.cards.maxTextureBanks,
    remainsMaxBanks: layer.remainsCards.maxTextureBanks, cardPages: layer.cards.pages.length,
    cardChunks: layer.cards.chunks.length, remainsPages: layer.remainsCards.pages.length,
    remainsChunks: layer.remainsCards.chunks.length, outsideMeasuredDraws: true });
  return layer;
};

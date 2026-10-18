import { describe, expect, it } from 'vitest';
import { CORE_SCENERY } from './art/scenery';
import { SCENERY } from '../campaigns/ashen-march/scenery';
import { MENU_SCENES } from './menu-scenes';
import { PROP_STANDS, propStand } from './prop-stands';

// @@@prop-stands - Every prop a scene or chapter can set declares whether it stands or lies flat (render contract, rule 1).
describe('prop stands', () => {
  it('are declared for every painted kind of prop and every prop a home scene sets', () => {
    const kinds = new Set([...Object.keys(CORE_SCENERY), ...Object.keys(SCENERY)]);
    for (const scene of MENU_SCENES) {
      const run = scene.create();
      for (const prop of run.props) kinds.add(prop.kind);
    }
    expect([...kinds].filter(kind => !(kind in PROP_STANDS))).toEqual([]);
  });

  it('refuse a kind that never declared itself', () => {
    expect(() => propStand('never-declared')).toThrow(/declares neither/);
  });
});

import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { OrthographicCamera, Vector3 } from 'three';
import { GUARDIAN_SCROLL } from '../shared/item-rules';
import type { WorldEffect } from '../shared/types';
import { sketchScene } from '../sdk/scene';
import { issueCommand } from '../shared/sim';
import { renderWorldEffects } from './effect-renderer';
import { configureWorldCamera, projectWorld } from './world3d/projection';
import { createI18n } from './i18n';
import { itemTooltip } from './tooltips';

describe('guardian scroll visible selection boundary', () => {
  it('renders the actual scroll cast as a full field even when its carrier knows the same-radius veteran ward', () => {
    const game = sketchScene('scroll-versus-veteran-ward').map('bareDuel').replaceDefaults().player('player')
      .unit('player', 'priest', 400, 400, { id: 'carrier' })
      .item('scroll', 'guardianScroll', 0, 0, { carrierId: 'carrier' }).build().createGame();
    const carrier = game.units[0]!; carrier.veteranSkill = 'veteranInnerFire';
    issueCommand(game, { type: 'useItem', unitId: carrier.id, itemId: 'scroll' });
    const effect = game.effects.find(effect => effect.type === 'guardianField')!;
    const canvas = createCanvas(800, 800), ctx = canvas.getContext('2d');
    const arcs: number[][] = [], nativeArc = ctx.arc.bind(ctx);
    ctx.arc = (...args: Parameters<typeof ctx.arc>) => { arcs.push([...args.slice(0, 3)] as number[]); nativeArc(...args); };
    renderWorldEffects({ ctx: ctx as unknown as CanvasRenderingContext2D, effects: [effect],
      worldToScreen: point => point, nearScreen: () => true, unit: () => carrier });
    expect(arcs[0]).toEqual([carrier.x, carrier.y, 180]);
    expect(arcs[1]?.[2]).toBeCloseTo(180 * .72, 9);
  });

  it.each([0.6, 1, 1.8])('matches ground points in Canvas and the actual Three camera at zoom %s', zoom => {
    const view = { x: 620, y: 500, width: 1600, height: 900, zoom };
    const field: WorldEffect = { id: 'cast', type: 'guardianField', x: 950, y: 850, radius: 180, duration: 140, remaining: 100 };
    const canvas = createCanvas(view.width, view.height), ctx = canvas.getContext('2d');
    const arcs: number[][] = [], nativeArc = ctx.arc.bind(ctx);
    ctx.arc = (...args: Parameters<typeof ctx.arc>) => { arcs.push([...args.slice(0, 3)] as number[]); nativeArc(...args); };
    ctx.scale(zoom, zoom);
    renderWorldEffects({ ctx: ctx as unknown as CanvasRenderingContext2D, effects: [field],
      worldToScreen: point => ({ x: point.x - view.x, y: point.y - view.y }), nearScreen: () => true });
    expect(arcs[0]).toEqual([330, 350, 180]);
    const camera = new OrthographicCamera(); configureWorldCamera(camera, view);
    for (let spoke = 0; spoke < 16; spoke++) {
      const angle = spoke * Math.PI / 8;
      const ground = { x: field.x + Math.cos(angle) * 180, y: field.y + Math.sin(angle) * 180 };
      const ndc = new Vector3(ground.x, 0, ground.y).project(camera);
      const gpu = { x: (ndc.x + 1) * view.width / 2, y: (1 - ndc.y) * view.height / 2 };
      const projected = projectWorld(view, ground);
      const [cx, cy, radius] = arcs[0]!;
      const visible = { x: (cx! + Math.cos(angle) * radius!) * zoom, y: (cy! + Math.sin(angle) * radius!) * zoom };
      expect(gpu.x).toBeCloseTo(visible.x, 6); expect(gpu.y).toBeCloseTo(visible.y, 6);
      expect(projected.x).toBeCloseTo(visible.x, 6); expect(projected.y).toBeCloseTo(visible.y, 6);
    }
  });

  it('retains an explicit saved radius and uses the current rule only when radius is absent', () => {
    for (const explicit of [undefined, 280]) {
      const canvas = createCanvas(800, 800), ctx = canvas.getContext('2d');
      const radii: number[] = [], nativeArc = ctx.arc.bind(ctx);
      ctx.arc = (...args: Parameters<typeof ctx.arc>) => { radii.push(args[2]); nativeArc(...args); };
      const effect: WorldEffect = { id: 'field', type: 'guardianField', x: 400, y: 400, duration: 140, remaining: 100,
        ...(explicit === undefined ? {} : { radius: explicit }) };
      renderWorldEffects({ ctx: ctx as unknown as CanvasRenderingContext2D, effects: [effect], worldToScreen: point => point, nearScreen: () => true });
      expect(radii[0]).toBe(explicit ?? GUARDIAN_SCROLL.radius);
    }
  });

  it.each(['en', 'zh'] as const)('reports the same reduced radius and unchanged duration in %s', locale => {
    const stats = itemTooltip('guardianScroll', undefined, createI18n(locale)).stats;
    expect(stats).toContain(locale === 'zh' ? '半径 180' : 'Radius 180');
    expect(stats.join(' ')).toContain('7.0s');
    expect(stats.join(' ')).not.toContain('280');
  });
});

import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { UNIT_DEFS } from '../../shared/catalog';
import type { UnitKind } from '../../shared/types';
import { paintFigure } from '../art/painted-units';
import { appearanceForKind } from '../art/unit-appearance';
import { equipmentForKind, type FigurePresentation } from '../art/rig';
import { actionPaintSize } from '../art/action-direction';
import type { UnitAnimationFrame } from '../unit-animation';
import { PaintBoundsTracker, type PaintBounds } from './card-paint-bounds';

function seeded(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

// A troop card's canvas as painted-card-batches paints it (see paintCanvas), with its painter's bounds tracked.
function card(size: number) {
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  return { ctx, tracker: new PaintBoundsTracker(ctx) };
}
function paintTracked(ctx: CanvasRenderingContext2D, tracker: PaintBoundsTracker, density: number, tileSize: number, paint: (b: CanvasRenderingContext2D) => void) {
  const size = tileSize * density;
  ctx.resetTransform(); ctx.clearRect(0, 0, size, size); tracker.begin();
  ctx.save(); ctx.scale(density, density); ctx.translate(tileSize / 2, tileSize / 2);
  try { paint(ctx); } finally { ctx.restore(); }
  return tracker.end();
}
// The pixels the drawing actually covers (any alpha), read back: what the tracked bounds must contain.
function painted(ctx: CanvasRenderingContext2D): PaintBounds {
  const { width, height } = ctx.canvas, data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? 'empty' : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
function expectContains(tracked: PaintBounds, actual: PaintBounds, label: string) {
  if (actual === 'empty' || tracked === 'whole') return;
  expect(tracked, label).not.toBe('empty');
  if (tracked === 'empty' || actual === 'whole') return;
  expect(tracked.x0 <= actual.x0 && tracked.y0 <= actual.y0 && tracked.x1 >= actual.x1 && tracked.y1 >= actual.y1, `${label}: ${JSON.stringify({ tracked, actual })}`).toBe(true);
}
const area = (box: PaintBounds) => typeof box === 'string' ? 0 : (box.x1 - box.x0) * (box.y1 - box.y0);

describe('troop card paint bounds', () => {
  it('bound strokes, curves, arcs, rotations, shadows and images, and give up on what they cannot bound', () => {
    const { ctx, tracker } = card(200);
    const cases: [string, (b: CanvasRenderingContext2D) => void][] = [
      ['rotated thick stroke', (b) => { b.rotate(0.7); b.lineWidth = 9; b.lineJoin = 'miter'; b.beginPath(); b.moveTo(-40, -10); b.lineTo(30, 20); b.lineTo(-20, 35); b.stroke(); }],
      ['bezier and quadratic', (b) => { b.beginPath(); b.moveTo(-50, 0); b.bezierCurveTo(-30, -70, 40, 60, 50, -10); b.quadraticCurveTo(0, 80, -50, 0); b.fill(); }],
      ['arc and ellipse under scale', (b) => { b.scale(1.5, 0.6); b.beginPath(); b.arc(10, 10, 25, 0, Math.PI * 2); b.ellipse(-20, -30, 15, 30, 0.4, 0, Math.PI * 2); b.fill(); }],
      ['shadowed rect', (b) => { b.shadowColor = '#000'; b.shadowBlur = 6; b.shadowOffsetX = 4; b.fillRect(-10, -10, 20, 20); }],
      ['saved and restored transforms', (b) => { b.save(); b.translate(60, 0); b.restore(); b.save(); b.translate(-30, 40); b.fillRect(0, 0, 10, 10); b.restore(); }],
    ];
    for (const [label, paint] of cases) { const tracked = paintTracked(ctx, tracker, 1, 200, paint); expectContains(tracked, painted(ctx), label); }
    expect(paintTracked(ctx, tracker, 1, 200, () => {})).toBe('empty');
    expect(paintTracked(ctx, tracker, 1, 200, (b) => { b.font = '12px sans-serif'; b.fillText('A', 0, 0); })).toBe('whole');
  });

  it("contain every pixel of every unit's art, across poses, equipment, facing and density", () => {
    const random = seeded(7), kinds = Object.keys(UNIT_DEFS) as UnitKind[];
    const weapons = [...new Set(kinds.map((kind) => equipmentForKind(kind)).filter((weapon) => weapon !== undefined)), 'greatSword' as const];
    const poses: UnitAnimationFrame[] = [];
    for (const mode of ['idle', 'walk'] as const) for (let frame = 0; frame < 8; frame++) {
      poses.push({ mode, frame });
      for (const carry of [1, 6]) for (const carryAim of [-6, 0, 6]) poses.push({ mode, frame, carry, carryAim });
    }
    for (let frame = 0; frame < 6; frame++) {
      for (let variant = 0; variant < 3; variant++) for (const aim of [-6, 0, 6]) poses.push({ mode: 'attack', frame, variant, aim });
      for (const aim of [-6, 0, 6]) poses.push({ mode: 'cast', frame, aim });
      poses.push({ mode: 'work', frame });
    }
    const canvases = new Map<number, ReturnType<typeof card>>();
    let checked = 0, whole = 0, trackedArea = 0, paintedArea = 0;
    const check = (kind: UnitKind, pose: UnitAnimationFrame, facing: 1 | -1, presentation: FigurePresentation, density: number) => {
      const tileSize = actionPaintSize(pose, kind), size = tileSize * density;
      let canvas = canvases.get(size); if (!canvas) canvases.set(size, canvas = card(size));
      const tracked = paintTracked(canvas.ctx, canvas.tracker, density, tileSize, (b) => { b.scale(facing, 1); paintFigure(b, kind, '#a85644', pose, facing, presentation); });
      const actual = painted(canvas.ctx);
      expectContains(tracked, actual, `${kind} ${JSON.stringify(pose)} ${facing} ${JSON.stringify(presentation)} @${density}`);
      checked++; if (tracked === 'whole') whole++; trackedArea += area(tracked); paintedArea += area(actual);
    };
    for (const kind of kinds) {
      // Every pose in the unit's own kit, both ways.
      for (const pose of poses) check(kind, pose, random() < .5 ? 1 : -1, appearanceForKind(kind), 1);
      // Every issued weapon and shield, in sampled poses, races and densities.
      for (const race of ['grove', 'ember'] as const) for (const weapon of [undefined, ...weapons]) for (const shield of [undefined, true, false]) {
        const presentation: FigurePresentation = { ...appearanceForKind(kind, race), ...(weapon ? { weapon } : {}), ...(shield !== undefined ? { shield, ...(shield ? { shieldStyle: 'round' as const } : {}) } : {}) };
        check(kind, poses[Math.floor(random() * poses.length)]!, random() < .5 ? 1 : -1, presentation, random() < .2 ? 2 : 1);
      }
    }
    console.log('BOUNDS', JSON.stringify({ checked, whole, ratio: trackedArea / paintedArea }));
    expect(checked).toBeGreaterThan(5_000);expect(whole).toBe(0);
    // Tight enough to be worth it: the tracked box is little more than what is painted.
    expect(trackedArea / paintedArea).toBeLessThan(1.6);
  }, 300_000);
});

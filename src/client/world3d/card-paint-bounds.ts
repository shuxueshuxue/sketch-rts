// @@@card-paint-bounds - What a painter covers, found while it paints rather than read back after: the context of a
// card canvas keeps its own copy of the current transform and grows a box, in canvas pixels, around every point a path
// passes through (curves by their control points, arcs and ellipses by their enclosing squares), every stroke's half
// width, every shadow and every image's rectangle, when that path or rectangle is filled, stroked or drawn. The box
// is conservative: clipping and erasing never shrink it. A drawing it cannot bound (a Path2D, text, an image's raw
// pixels, a CSS filter) makes the whole canvas the box. Painting is hot, so the wrappers take fixed arguments and the
// transform is six numbers, not an array.
export type PaintBox = { x0: number; y0: number; x1: number; y1: number };
export type PaintBounds = PaintBox | 'empty' | 'whole';

// Antialiasing reaches a pixel past an edge; one more covers rounding of the box to whole pixels.
const EDGE = 2;

export class PaintBoundsTracker {
  // The current transform (a, b, c, d, e, f) and the saved ones, six numbers each.
  private a = 1; private b = 0; private c = 0; private d = 1; private e = 0; private f = 0;
  private stack: number[] = [];
  // The current path's box and the drawing's, in canvas pixels; x0 > x1 while empty.
  private px0 = Infinity; private py0 = Infinity; private px1 = -Infinity; private py1 = -Infinity;
  private bx0 = Infinity; private by0 = Infinity; private bx1 = -Infinity; private by1 = -Infinity;
  private whole = false;
  constructor(private ctx: CanvasRenderingContext2D) { this.install(); }

  /** Starts a new drawing on a cleared canvas whose transform is the identity. */
  begin() {
    this.identity(); this.stack.length = 0; this.clearPath();
    this.bx0 = this.by0 = Infinity; this.bx1 = this.by1 = -Infinity; this.whole = false;
  }

  /** What the drawing since begin covers, in canvas pixels, clamped to the canvas. */
  end(): PaintBounds {
    const { width, height } = this.ctx.canvas;
    if (this.whole) return 'whole';
    if (this.bx0 > this.bx1) return 'empty';
    const x0 = Math.max(0, Math.floor(this.bx0) - EDGE), y0 = Math.max(0, Math.floor(this.by0) - EDGE);
    const x1 = Math.min(width, Math.ceil(this.bx1) + EDGE), y1 = Math.min(height, Math.ceil(this.by1) + EDGE);
    return x1 <= x0 || y1 <= y0 ? 'empty' : { x0, y0, x1, y1 };
  }

  private identity() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  private clearPath() { this.px0 = this.py0 = Infinity; this.px1 = this.py1 = -Infinity; }
  private point(x: number, y: number) {
    const px = this.a * x + this.c * y + this.e, py = this.b * x + this.d * y + this.f;
    if (!(px > -Infinity && px < Infinity && py > -Infinity && py < Infinity)) return;
    if (px < this.px0) this.px0 = px; if (px > this.px1) this.px1 = px; if (py < this.py0) this.py0 = py; if (py > this.py1) this.py1 = py;
  }
  private square(x: number, y: number, r: number) { r = Math.abs(r); this.point(x - r, y - r); this.point(x + r, y - r); this.point(x - r, y + r); this.point(x + r, y + r); }
  private rectangle(x: number, y: number, w: number, h: number) { this.point(x, y); this.point(x + w, y); this.point(x, y + h); this.point(x + w, y + h); }
  // How far, in canvas pixels, a stroke of the current width and joins reaches past its path.
  private reach() {
    const ctx = this.ctx, scale = Math.max(Math.hypot(this.a, this.b), Math.hypot(this.c, this.d));
    // Round joins and caps reach half the width; a miter up to its limit; a square cap's corner half the diagonal.
    const joins = ctx.lineJoin === 'miter' ? Math.max(ctx.miterLimit, Math.SQRT2) : ctx.lineCap === 'square' ? Math.SQRT2 : 1;
    return ctx.lineWidth / 2 * joins * scale;
  }
  // The current path, grown by reach and any shadow, joins the drawing's box.
  private paint(reach: number) {
    if (this.px0 > this.px1) return;
    const ctx = this.ctx;
    if (ctx.filter && ctx.filter !== 'none') { this.whole = true; return; }
    const shadow = ctx.shadowBlur || ctx.shadowOffsetX || ctx.shadowOffsetY ? ctx.shadowBlur * 2 + Math.max(Math.abs(ctx.shadowOffsetX), Math.abs(ctx.shadowOffsetY)) : 0;
    const grow = reach + shadow;
    if (this.px0 - grow < this.bx0) this.bx0 = this.px0 - grow; if (this.py0 - grow < this.by0) this.by0 = this.py0 - grow;
    if (this.px1 + grow > this.bx1) this.bx1 = this.px1 + grow; if (this.py1 + grow > this.by1) this.by1 = this.py1 + grow;
  }
  // A rectangle drawn on its own, outside the current path.
  private paintRectangle(x: number, y: number, w: number, h: number, reach: number) {
    const { px0, py0, px1, py1 } = this;
    this.clearPath(); this.rectangle(x, y, w, h); this.paint(reach);
    this.px0 = px0; this.py0 = py0; this.px1 = px1; this.py1 = py1;
  }
  private multiply(a: number, b: number, c: number, d: number, e: number, f: number) {
    const { a: a0, b: b0, c: c0, d: d0 } = this;
    this.e += a0 * e + c0 * f; this.f += b0 * e + d0 * f;
    this.a = a0 * a + c0 * b; this.b = b0 * a + d0 * b; this.c = a0 * c + c0 * d; this.d = b0 * c + d0 * d;
  }

  private install() {
    const ctx = this.ctx as unknown as Record<string, unknown>, proto = Object.getPrototypeOf(this.ctx) as Record<string, (...args: unknown[]) => unknown>, t = this;
    const own = (name: string, wrapper: (original: (...args: unknown[]) => unknown) => unknown) => { ctx[name] = wrapper(proto[name]!); };
    own('save', (o) => function (this: unknown) { t.stack.push(t.a, t.b, t.c, t.d, t.e, t.f); return o.call(this); });
    own('restore', (o) => function (this: unknown) {
      const s = t.stack; if (s.length >= 6) { t.f = s.pop()!; t.e = s.pop()!; t.d = s.pop()!; t.c = s.pop()!; t.b = s.pop()!; t.a = s.pop()!; }
      return o.call(this);
    });
    own('translate', (o) => function (this: unknown, x: number, y: number) { t.multiply(1, 0, 0, 1, x, y); return o.call(this, x, y); });
    own('scale', (o) => function (this: unknown, x: number, y: number) { t.multiply(x, 0, 0, y, 0, 0); return o.call(this, x, y); });
    own('rotate', (o) => function (this: unknown, angle: number) { const c = Math.cos(angle), s = Math.sin(angle); t.multiply(c, s, -s, c, 0, 0); return o.call(this, angle); });
    own('transform', (o) => function (this: unknown, a: number, b: number, c: number, d: number, e: number, f: number) { t.multiply(a, b, c, d, e, f); return o.call(this, a, b, c, d, e, f); });
    own('setTransform', (o) => function (this: unknown) {
      const a = arguments[0];
      if (typeof a === 'number') { t.a = a; t.b = arguments[1]; t.c = arguments[2]; t.d = arguments[3]; t.e = arguments[4]; t.f = arguments[5]; }
      else { const m = (a ?? {}) as DOMMatrix2DInit; t.a = m.a ?? m.m11 ?? 1; t.b = m.b ?? m.m12 ?? 0; t.c = m.c ?? m.m21 ?? 0; t.d = m.d ?? m.m22 ?? 1; t.e = m.e ?? m.m41 ?? 0; t.f = m.f ?? m.m42 ?? 0; }
      return o.apply(this, arguments as unknown as unknown[]);
    });
    own('resetTransform', (o) => function (this: unknown) { t.identity(); return o.call(this); });
    own('beginPath', (o) => function (this: unknown) { t.clearPath(); return o.call(this); });
    own('moveTo', (o) => function (this: unknown, x: number, y: number) { t.point(x, y); return o.call(this, x, y); });
    own('lineTo', (o) => function (this: unknown, x: number, y: number) { t.point(x, y); return o.call(this, x, y); });
    own('quadraticCurveTo', (o) => function (this: unknown, cx: number, cy: number, x: number, y: number) { t.point(cx, cy); t.point(x, y); return o.call(this, cx, cy, x, y); });
    own('bezierCurveTo', (o) => function (this: unknown, c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) { t.point(c1x, c1y); t.point(c2x, c2y); t.point(x, y); return o.call(this, c1x, c1y, c2x, c2y, x, y); });
    // An arcTo stays within the triangle of the current point and its two control points.
    own('arcTo', (o) => function (this: unknown, x1: number, y1: number, x2: number, y2: number, r: number) { t.point(x1, y1); t.point(x2, y2); return o.call(this, x1, y1, x2, y2, r); });
    own('arc', (o) => function (this: unknown) { t.square(arguments[0], arguments[1], arguments[2]); return o.apply(this, arguments as unknown as unknown[]); });
    own('ellipse', (o) => function (this: unknown) { t.square(arguments[0], arguments[1], Math.max(Math.abs(arguments[2]), Math.abs(arguments[3]))); return o.apply(this, arguments as unknown as unknown[]); });
    own('rect', (o) => function (this: unknown, x: number, y: number, w: number, h: number) { t.rectangle(x, y, w, h); return o.call(this, x, y, w, h); });
    own('roundRect', (o) => function (this: unknown) { t.rectangle(arguments[0], arguments[1], arguments[2], arguments[3]); return o.apply(this, arguments as unknown as unknown[]); });
    own('fill', (o) => function (this: unknown) { const path = arguments[0]; if (path !== undefined && typeof path !== 'string') t.whole = true; else t.paint(0); return o.apply(this, arguments as unknown as unknown[]); });
    own('stroke', (o) => function (this: unknown) { if (arguments[0] !== undefined) t.whole = true; else t.paint(t.reach()); return o.apply(this, arguments as unknown as unknown[]); });
    own('fillRect', (o) => function (this: unknown, x: number, y: number, w: number, h: number) { t.paintRectangle(x, y, w, h, 0); return o.call(this, x, y, w, h); });
    own('strokeRect', (o) => function (this: unknown, x: number, y: number, w: number, h: number) { t.paintRectangle(x, y, w, h, t.reach()); return o.call(this, x, y, w, h); });
    own('drawImage', (o) => function (this: unknown) {
      const n = arguments.length, image = arguments[0] as { width: number; height: number };
      if (n >= 9) t.paintRectangle(arguments[5], arguments[6], arguments[7], arguments[8], 0);
      else if (n >= 5) t.paintRectangle(arguments[1], arguments[2], arguments[3], arguments[4], 0);
      else t.paintRectangle(arguments[1], arguments[2], image.width, image.height, 0);
      return o.apply(this, arguments as unknown as unknown[]);
    });
    for (const name of ['fillText', 'strokeText', 'putImageData']) own(name, (o) => function (this: unknown) { t.whole = true; return o.apply(this, arguments as unknown as unknown[]); });
  }
}

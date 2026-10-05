// @@@det-math - Sine and cosine that give the same bits on every platform. Math.sin and Math.cos are C++ library code
// inside V8, and they differ between builds: on the same inputs, node 26 on arm64 and node 22 on x64 disagree by one ulp in
// about 0.5% of results (Math.atan2 0.2%; Math.hypot and Math.sqrt agree). One such ulp in a V8 staging point turned a
// gauntlet game from a V8 win into a V7 win on one machine only. These use only + - * / and Math.round, which JavaScript
// rounds the same way everywhere (no fused multiply-add), so the simulation and the AIs compute the same game on any
// machine. They are the fdlibm kernels with its Cody-Waite reduction by pi/2, accurate to about an ulp, for the angles a
// game uses (|x| up to about 800,000 radians).
//
// The kernel coefficients and reduction constants are from FreeBSD msun (k_sin.c, k_cos.c, e_rem_pio2.c):
// ====================================================
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PI_4 = 0.7853981633974483;
const MAX_ARGUMENT = 823_549.6;

// sin(x + y) for |x + y| <= pi/4, y the tail of a reduced argument (0 when there is none).
function kernelSin(x: number, y: number, hasTail: boolean) {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (!hasTail) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

// cos(x + y) for |x + y| <= pi/4.
function kernelCos(x: number, y: number) {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const u = 1 - hz;
  return u + (1 - u - hz + (z * r - x * y));
}

// x - n * pi/2 as head + tail, with n the nearest integer to x / (pi/2); two rounds of pi/2 in 33-bit pieces.
function reduce(x: number): { n: number; head: number; tail: number } {
  if (!(Math.abs(x) <= MAX_ARGUMENT)) throw new Error(`det-math: angle ${x} outside the supported range`);
  const n = Math.round(x * INV_PIO2);
  const first = x - n * PIO2_1;
  let w = n * PIO2_1T;
  const r = first - n * PIO2_2;
  w = n * PIO2_2T - (first - r - n * PIO2_2);
  const head = r - w;
  return { n, head, tail: r - head - w };
}

export function detSin(x: number): number {
  if (Number.isNaN(x) || !Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= PI_4) return x === 0 ? x : kernelSin(x, 0, false);
  const { n, head, tail } = reduce(x);
  switch (n & 3) {
    case 0:
      return kernelSin(head, tail, true);
    case 1:
      return kernelCos(head, tail);
    case 2:
      return -kernelSin(head, tail, true);
    default:
      return -kernelCos(head, tail);
  }
}

export function detCos(x: number): number {
  if (Number.isNaN(x) || !Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= PI_4) return kernelCos(x, 0);
  const { n, head, tail } = reduce(x);
  switch (n & 3) {
    case 0:
      return kernelCos(head, tail);
    case 1:
      return -kernelSin(head, tail, true);
    case 2:
      return -kernelCos(head, tail);
    default:
      return kernelSin(head, tail, true);
  }
}

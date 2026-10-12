/** Two numeric coordinates, with the operation order of Node 20 / V8 11.3's
 * MathHypot (https://github.com/v8/v8/blob/11.3.244/src/builtins/math.tq).
 * Scaling avoids intermediate overflow and underflow. For two
 * terms, Kahan's first compensation is zero, so the normalized squares can
 * be added directly without the variadic builtin's temporary double array.
 */
export function hypot2(x: number, y: number): number {
  const absX = Math.abs(x), absY = Math.abs(y);
  // Math.hypot gives infinity precedence over NaN.
  if (absX === Infinity || absY === Infinity) return Infinity;
  const max = Math.max(absX, absY);
  if (max === 0) return 0;
  const a = absX / max, b = absY / max;
  return Math.sqrt(a * a + b * b) * max;
}

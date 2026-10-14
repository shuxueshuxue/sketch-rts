/** Display kilograms to 0.1 kg without floating-point noise or trailing zeroes. */
export function formatMass(mass: number) {
  return Number(mass.toFixed(1)).toString();
}

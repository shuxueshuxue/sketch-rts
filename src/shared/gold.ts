/** Gold stays in gold units in snapshots; all transactions settle in integer cents.
 * Math.round chooses the higher cent on a half-cent tie.
 */
export function roundGold(amount: number) {
  return Math.round(amount * 100) / 100;
}

export function addGold(balance: number, amount: number) {
  return (Math.round(balance * 100) + Math.round(amount * 100)) / 100;
}

/**
 * Whole-number percentage shares of a total that always add up to 100.
 *
 * Rounding each share on its own can land on 99 or 101 (three equal thirds show 33% three times).
 * The largest-remainder method rounds every share down, then hands the missing points, one each,
 * to the shares that lost the most; a tie goes to the earlier share, so the result is stable.
 * Zero and negative amounts get 0, and an empty or all-zero list gets all zeros (no total, no 100).
 */
export function percentShares(amounts: readonly number[]): number[] {
  const positive = amounts.map((amount) => (amount > 0 ? amount : 0));
  const total = positive.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return positive.map(() => 0);

  const exact = positive.map((amount) => (amount / total) * 100);
  const shares = exact.map((value) => Math.floor(value));
  let missing = 100 - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    // Only a share that has something to round up may take a point.
    .filter(({ index }) => positive[index] > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let at = 0; missing > 0 && order.length; at += 1) {
    shares[order[at % order.length].index] += 1;
    missing -= 1;
  }
  return shares;
}

/** Reading-only follow-on grid references. The first price comes from the fund
 * engine; later levels neither change its entry trigger nor allocate orders. */
export function dividendFundGridPrices(entryPriceMicros?: number): number[] {
  if (entryPriceMicros === undefined || !Number.isSafeInteger(entryPriceMicros) || entryPriceMicros <= 0) return [];
  const first = BigInt(entryPriceMicros);
  const second = (first * 9n + 5n) / 10n;
  const third = (second * 19n + 10n) / 20n;
  return [Number(first), Number(second), Number(third)];
}

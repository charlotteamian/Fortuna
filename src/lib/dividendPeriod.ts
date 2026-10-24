/**
 * August starts the observation window in which the preceding fiscal year's
 * annual cash distribution is treated as completed. This is a distribution
 * completion convention, not the annual report publication deadline.
 */
export function latestCompletedDividendYear(asOf: string): number {
  return Number(asOf.slice(0, 4)) - (Number(asOf.slice(5, 7)) >= 8 ? 1 : 2);
}

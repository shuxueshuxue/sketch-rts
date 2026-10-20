/** Keep unanswered episodes separate; an absent response is never a zero-second arrival. */
export function summarizeRoomAbResponses(responses: readonly { start: number; arrival: number | null; endReason: string | null }[]) {
  const delaysSeconds = responses.flatMap(row => row.arrival === null ? [] : [(row.arrival - row.start) / 20]).sort((a, b) => a - b);
  const count = delaysSeconds.length, middle = Math.floor(count / 2);
  return { episodes: responses.length, arrivals: count, censored: responses.length - count,
    meanSeconds: count ? delaysSeconds.reduce((a, b) => a + b, 0) / count : null,
    medianSeconds: count ? count % 2 ? delaysSeconds[middle]! : (delaysSeconds[middle - 1]! + delaysSeconds[middle]!) / 2 : null,
    censoredReasons: responses.filter(row => row.arrival === null).reduce<Record<string, number>>((result, row) => {
      const reason = row.endReason ?? 'open'; result[reason] = (result[reason] ?? 0) + 1; return result;
    }, {}), delaysSeconds };
}

// Pure helpers (no `$`) are easy to unit test.

export function describeCounts(counts: ReadonlyMap<string, number>): string {
  if (counts.size === 0) return 'No tool calls yet.'
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tool, n]) => `${tool}: ${n}`)
    .join('\n')
}

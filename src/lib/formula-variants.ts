export function isSingleHerbAddition(pair: {
  kind: string
  addedHerbNames?: string[]
  removedHerbNames?: string[]
}): boolean {
  if (pair.kind === 'add') return true
  return (pair.addedHerbNames?.length ?? 0) === 1 && (pair.removedHerbNames?.length ?? 0) === 0
}

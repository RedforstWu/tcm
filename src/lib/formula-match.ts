export interface MatchHerb {
  herbId: string
  name: string
  doseLiang?: number
  doseCount?: number
  doseRaw?: string
}

export interface DoseAwareScore {
  score: number
  doseNotes: string[]
}

function jaccard(left: Set<string>, right: Set<string>): number {
  let overlap = 0
  for (const id of left) if (right.has(id)) overlap += 1
  const union = left.size + right.size - overlap
  return union === 0 ? 0 : overlap / union
}

function comparableRatio(left: MatchHerb, right: MatchHerb): number | null {
  if (
    left.doseLiang !== undefined &&
    right.doseLiang !== undefined &&
    left.doseLiang > 0 &&
    right.doseLiang > 0
  ) {
    return Math.min(left.doseLiang, right.doseLiang) / Math.max(left.doseLiang, right.doseLiang)
  }
  if (
    left.doseLiang === undefined &&
    right.doseLiang === undefined &&
    left.doseCount !== undefined &&
    right.doseCount !== undefined &&
    left.doseCount > 0 &&
    right.doseCount > 0
  ) {
    return Math.min(left.doseCount, right.doseCount) / Math.max(left.doseCount, right.doseCount)
  }
  return null
}

export function doseAwareScore(query: MatchHerb[], candidate: MatchHerb[]): DoseAwareScore {
  const queryIds = new Set(query.map((herb) => herb.herbId))
  const candidateIds = new Set(candidate.map((herb) => herb.herbId))
  const composition = jaccard(queryIds, candidateIds)
  if (composition === 0) return { score: 0, doseNotes: [] }

  const candidateById = new Map(candidate.map((herb) => [herb.herbId, herb]))
  const queryById = new Map(query.map((herb) => [herb.herbId, herb]))
  let ratioSum = 0
  let shared = 0
  const doseNotes: string[] = []

  for (const herbId of queryIds) {
    if (!candidateIds.has(herbId)) continue
    shared += 1
    const left = queryById.get(herbId)!
    const right = candidateById.get(herbId)!
    const ratio = comparableRatio(left, right)
    if (ratio === null) {
      doseNotes.push(`${left.name}：剂量不明`)
      continue
    }
    ratioSum += ratio
    if (ratio < 1) {
      doseNotes.push(`${left.name}：${left.doseRaw ?? ''} / ${right.doseRaw ?? ''}`)
    }
  }

  const doseFactor = shared === 0 ? 1 : ratioSum / shared
  return { score: composition * doseFactor, doseNotes }
}

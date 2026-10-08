import type { AlignmentRecord, Clause, ParallelAlignment } from '../../src/types/data.ts'
import { normalizeForCompare } from './wiki.ts'

function trigrams(text: string): Set<string> {
  const normalized = normalizeForCompare(text)
  const grams = new Set<string>()
  if (normalized.length < 3) {
    grams.add(normalized)
    return grams
  }
  for (let i = 0; i < normalized.length - 2; i += 1) {
    grams.add(normalized.slice(i, i + 3))
  }
  return grams
}

function similarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const gram of ta) if (tb.has(gram)) inter += 1
  return (2 * inter) / (ta.size + tb.size)
}

export function alignSongbenToGuilin(
  songben: Clause[],
  guilin: Clause[],
): { alignments: AlignmentRecord[]; uniqueGuilinIds: string[] } {
  const alignments: AlignmentRecord[] = []
  const usedGuilin = new Set<string>()

  for (const clause of songben) {
    let bestId: string | null = null
    let bestScore = 0
    for (const candidate of guilin) {
      // 优先同六经篇章
      const chapterBonus =
        clause.channelTags[0] && candidate.chapter.includes(clause.channelTags[0]) ? 0.05 : 0
      const score = similarity(clause.text, candidate.text) + chapterBonus
      if (score > bestScore) {
        bestScore = score
        bestId = candidate.id
      }
    }
    if (bestId && bestScore >= 0.35) {
      usedGuilin.add(bestId)
      alignments.push({ songbenId: clause.id, guilinId: bestId, score: Number(bestScore.toFixed(3)) })
      clause.alignedGuilinId = bestId
    } else {
      alignments.push({ songbenId: clause.id, guilinId: null, score: Number(bestScore.toFixed(3)) })
    }
  }

  const uniqueGuilinIds = guilin.filter((clause) => !usedGuilin.has(clause.id)).map((clause) => clause.id)
  return { alignments, uniqueGuilinIds }
}

/**
 * 陈傅对照：女科 ↔ 辨证录，男科 ↔ 辨证录/石室。
 * 回写 parallelIds；调用方统计时以辨证录为主去重。
 */
export function alignChenfuParallels(
  left: Clause[],
  right: Clause[],
  threshold = 0.42,
): ParallelAlignment[] {
  const alignments: ParallelAlignment[] = []
  const usedRight = new Set<string>()

  for (const clause of left) {
    let bestId: string | null = null
    let bestScore = 0
    let bestBook = right[0]?.book
    for (const candidate of right) {
      if (usedRight.has(candidate.id)) continue
      const headingBonus =
        clause.heading &&
        candidate.heading &&
        (clause.heading.includes(candidate.heading.slice(0, 2)) ||
          candidate.heading.includes(clause.heading.slice(0, 2)))
          ? 0.08
          : 0
      const score = similarity(clause.text, candidate.text) + headingBonus
      if (score > bestScore) {
        bestScore = score
        bestId = candidate.id
        bestBook = candidate.book
      }
    }
    if (bestId && bestScore >= threshold) {
      usedRight.add(bestId)
      alignments.push({
        leftId: clause.id,
        rightId: bestId,
        score: Number(bestScore.toFixed(3)),
        leftBook: clause.book,
        rightBook: bestBook,
      })
      clause.parallelIds = [...(clause.parallelIds ?? []), bestId]
      const rightClause = right.find((item) => item.id === bestId)
      if (rightClause) {
        rightClause.parallelIds = [...(rightClause.parallelIds ?? []), clause.id]
      }
    } else {
      alignments.push({
        leftId: clause.id,
        rightId: null,
        score: Number(bestScore.toFixed(3)),
        leftBook: clause.book,
      })
    }
  }
  return alignments
}

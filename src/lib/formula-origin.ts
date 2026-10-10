import { bookTitle } from '@/lib/data'
import type { BookId } from '@/types/data'

const FORMULA_ID_MARK = '-formula-'

export function backfillOriginNote(donorId: string): string {
  const mark = donorId.indexOf(FORMULA_ID_MARK)
  const bookId = mark > 0 ? donorId.slice(0, mark) : ''
  const formulaName = mark > 0 ? donorId.slice(mark + FORMULA_ID_MARK.length) : donorId
  const book = bookId ? bookTitle(bookId as BookId) : '他书'
  return `本书未载此方组成。药物与煎服法来自${book}「${formulaName}」，不是本书原文。`
}

export function sameNameVariantNote(formulaName: string): string {
  return `同名异方：本方药物与宋本「${formulaName}」不同。`
}

export function searchSnippet(
  id: string,
  text: string,
  provenance: { backfill: Record<string, string>; sameNameVariant: Record<string, string> },
): string {
  const donorId = provenance.backfill[id]
  if (donorId) return backfillOriginNote(donorId)
  const variantName = provenance.sameNameVariant[id]
  if (variantName) return `${sameNameVariantNote(variantName)} ${text}`.trim()
  return text.slice(0, 120)
}

export function formulaOriginNote(
  formula: { name: string; herbsBackfilledFrom?: string; herbs: Array<{ herbId: string }> },
  songbenTwin?: { herbs: Array<{ herbId: string }> } | null,
): string | null {
  if (formula.herbsBackfilledFrom) return backfillOriginNote(formula.herbsBackfilledFrom)
  if (!songbenTwin || formula.herbs.length === 0 || songbenTwin.herbs.length === 0) return null
  const own = new Set(formula.herbs.map((herb) => herb.herbId))
  const songben = new Set(songbenTwin.herbs.map((herb) => herb.herbId))
  const same = own.size === songben.size && [...own].every((id) => songben.has(id))
  return same ? null : sameNameVariantNote(formula.name)
}

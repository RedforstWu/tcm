import path from 'node:path'
import type { BookId, Clause, Formula } from '../../src/types/data.ts'
import {
  buildClausesFromSections,
  mergeParenDoseFormulas,
  splitWikiSections,
} from '../lib/generic-wiki-parse.ts'
import { extractZhongxiSectionFormulas } from '../lib/zhongxi-formula.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'

const BOOK_ID = 'zhongxi' as BookId
const RAW_FILENAME = 'zhongxi-canxi.wiki'

/**
 * 《医学衷中参西录》：wiki 标题切章，段落为条文；
 * 医方卷标题下括注剂量药列补全自创方。
 */
export async function runZhongxiParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: {
    chapterCount: number
    clauseCount: number
    formulaCount: number
    truncated: boolean
  }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', RAW_FILENAME))
  const sections = splitWikiSections(raw)
  const { clauses, formulas: baseFormulas } = buildClausesFromSections({
    bookId: BOOK_ID,
    sections,
    splitIntoParagraphs: true,
  })
  const formulas = mergeParenDoseFormulas(
    baseFormulas,
    extractZhongxiSectionFormulas(raw),
    BOOK_ID,
  )

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, `${BOOK_ID}.json`), { clauses, formulas })

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: sections.length,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
      truncated: false,
    },
  }
}

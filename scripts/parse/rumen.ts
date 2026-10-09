import path from 'node:path'
import type { BookId, Clause, Formula } from '../../src/types/data.ts'
import { buildClausesFromSections } from '../lib/generic-wiki-parse.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { splitSkqsVolumes } from '../lib/skqs-wiki.ts'

const BOOK_ID = 'rumen' as BookId
const RAW_FILE = 'rumen-shiqin.wiki'

/**
 * 《儒门事亲》：按 SUBPAGE / SKQS header 分卷 → 段落条文，方名正则抽取。
 */
export async function runRumenParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: { chapterCount: number; clauseCount: number; formulaCount: number }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', RAW_FILE))
  const sections = splitSkqsVolumes(raw)
  const { clauses, formulas } = buildClausesFromSections({
    bookId: BOOK_ID,
    sections,
  })

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
    },
  }
}

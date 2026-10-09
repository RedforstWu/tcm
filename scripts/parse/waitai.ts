import path from 'node:path'
import type { BookId, Clause, Formula } from '../../src/types/data.ts'
import { buildFangshuDataset } from '../lib/fangshu-formula.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'

const BOOK_ID = 'waitai' as BookId
const RAW_FILE = 'waitai-miyao.wiki'

/** 《外台秘要方》：组方基准库 */
export async function runWaitaiParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: {
    chapterCount: number
    clauseCount: number
    formulaCount: number
    withHerbs: number
  }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', RAW_FILE))
  const result = buildFangshuDataset({
    bookId: BOOK_ID,
    raw,
    mode: 'waitai',
    doseSystem: 'han',
  })

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, `${BOOK_ID}.json`), {
    clauses: result.clauses,
    formulas: result.formulas,
  })
  return result
}

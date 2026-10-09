import path from 'node:path'
import type { BookId, Clause, Formula } from '../../src/types/data.ts'
import { buildFangshuDataset } from '../lib/fangshu-formula.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'

const BOOK_ID = 'qianjin' as BookId
const RAW_FILE = 'qianjin-yaofang.wiki'
/** 药味以全角空格分隔、旧清洗删空格后粘连为 0 味而被跳过的方块；排末尾以免 qianjin-001-0839 之后的条文 id 位移 */
const RECOVERED_BLOCK_NAMES = ['白马茎丸'] as const

/** 《备急千金要方》：组方基准库 */
export async function runQianjinParse(): Promise<{
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
    mode: 'classical',
    doseSystem: 'han',
    appendedBlockNames: RECOVERED_BLOCK_NAMES,
  })

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, `${BOOK_ID}.json`), {
    clauses: result.clauses,
    formulas: result.formulas,
  })
  return result
}

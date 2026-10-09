import assert from 'node:assert/strict'
import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import { extractChenfuFormulaBlocks } from '../lib/chenfu-formula.ts'
import {
  buildHerbLexicon,
  extractBencaoHerbNames,
} from '../lib/herb-lexicon.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { listWikiHeadings, splitHeadingUnits } from '../lib/generic-wiki-parse.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'

const CLAUSE_HEADING_LEVEL = 4
const CHAPTER_HEADING_LEVEL = 3
/** 非四级标题下直接正文的检出阈值（与女科一致） */
const MIN_UNIT_BODY_LENGTH = 20

function extractMisjudgment(text: string): Clause['misjudgment'] | undefined {
  const simplified = toSimplifiedChinese(text)
  const match = simplified.match(
    /人以为([^，。；]{2,40})[，,]?\s*谁知([^。]{2,60})/,
  )
  if (!match) return undefined
  return {
    commonView: match[1]!.trim(),
    trueView: match[2]!.replace(/[乎耶哉].*$/, '').trim(),
  }
}

export async function runFunankeParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: { chapterCount: number; clauseCount: number; formulaCount: number }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', 'funanke.wiki'))
  let bencaoNames: string[] = []
  try {
    const bencao = await readText(path.join(root, 'data', 'raw', 'bencao-xinbian.wiki'))
    bencaoNames = extractBencaoHerbNames(bencao)
  } catch {
    bencaoNames = []
  }
  const lexicon = buildHerbLexicon(bencaoNames)
  const simplified = toSimplifiedChinese(raw)

  const clauses: Clause[] = []
  const formulas: Formula[] = []

  // ==== 伤风 ==== 为条文，正文止于下一个任意级标题；=== 章 === 只作 chapter
  const units = splitHeadingUnits(simplified, CLAUSE_HEADING_LEVEL, MIN_UNIT_BODY_LENGTH)
  const headers = units.filter((unit) => !unit.orphan)
  // 男科无「三级标题自带正文」的小节；若原文变动出现，须像女科那样另编号，不可静默丢弃
  assert.equal(units.length, headers.length, 'funanke: 出现未归属四级小节的正文')
  const chapters = listWikiHeadings(simplified)
    .filter((heading) => heading.level === CHAPTER_HEADING_LEVEL)
    .map((heading) => ({ title: heading.title, index: heading.start }))

  function chapterAt(pos: number): { title: string; order: number } {
    let title = '男科'
    let order = 0
    for (let i = 0; i < chapters.length; i += 1) {
      if (chapters[i]!.index <= pos) {
        title = chapters[i]!.title
        order = i + 1
      }
    }
    return { title, order }
  }

  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i]!
    const chap = chapterAt(header.start)
    let body = header.body
    // 男科常把「方用」写在叙述末尾同一句，补换行便于块解析
    body = body.replace(/方用\s*(?=\n)/g, '方用\n')
    body = body.replace(/，方用/g, '。\n方用\n')
    body = body.replace(/方用(?=[\u4e00-\u9fff])/g, '方用\n')
    if (body.length < 15) continue

    const clauseId = `funanke-${String(i + 1).padStart(4, '0')}`
    const blocks = extractChenfuFormulaBlocks(body, {
      anonymousPrefix: header.title,
      lexicon,
    })

    // 男科部分条目药味在「方用」后无「汤名」，extract 应能抓到
    // 若完全没抓到但正文有剂量括号，整段再试一次
    let usedBlocks = blocks
    if (usedBlocks.length === 0 && /[（(][^）)]*(?:钱|錢|两|兩)/.test(body)) {
      usedBlocks = extractChenfuFormulaBlocks(`方用\n${body}`, {
        anonymousPrefix: header.title,
        lexicon,
      })
    }

    const formulaIds: string[] = []
    let mainFormulaId: string | undefined
    for (let fi = 0; fi < usedBlocks.length; fi += 1) {
      const block = usedBlocks[fi]!
      const formulaId = `funanke-formula-${clauseId}-${fi + 1}`
      if (fi === 0) mainFormulaId = formulaId
      formulaIds.push(formulaId)
      formulas.push({
        id: formulaId,
        name: block.name,
        book: 'funanke',
        herbs: block.herbs,
        preparation: block.preparation,
        modifications: [],
        sourceClauseIds: [clauseId],
        chapter: chap.title,
        doseSystem: 'qing',
        role: block.role,
        alternateOf: block.role === 'alternate' ? mainFormulaId : undefined,
        derivedFrom: block.derivedFrom,
        fangjie: block.fangjie,
        anonymous: block.anonymous,
      })
    }

    clauses.push({
      id: clauseId,
      book: 'funanke',
      chapter: chap.title,
      chapterOrder: chap.order,
      order: i + 1,
      text: body.slice(0, 2000),
      formulaIds,
      symptomTags: [],
      pulseTags: [],
      channelTags: [],
      pathogenesisTags: [],
      reviewStatus: 'ai-draft',
      heading: header.title,
      misjudgment: extractMisjudgment(body),
    })
  }

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, 'funanke.json'), { clauses, formulas })

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: new Set(clauses.map((c) => c.chapter)).size,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
    },
  }
}

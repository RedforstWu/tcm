import assert from 'node:assert/strict'
import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import {
  buildHerbLexicon,
  extractBencaoHerbNames,
} from '../lib/herb-lexicon.ts'
import { extractChenfuFormulaBlocks } from '../lib/chenfu-formula.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import {
  listWikiHeadings,
  splitHeadingUnits,
  type WikiHeadingUnit,
} from '../lib/generic-wiki-parse.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'

const CLAUSE_HEADING_LEVEL = 4
const CHAPTER_HEADING_LEVEL = 3
/** 短于此的正文不立条文（沿用原阈值） */
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

export async function runFunvkeParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: { chapterCount: number; clauseCount: number; formulaCount: number }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', 'funvke.wiki'))
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

  // ==== 白帶下（一） ====（四级标题）为条文；章（=== 帶下 ===）只作 chapter
  const units = splitHeadingUnits(simplified, CLAUSE_HEADING_LEVEL, MIN_UNIT_BODY_LENGTH)
  const headers = units.filter((unit) => !unit.orphan)
  const chapters = listWikiHeadings(simplified)
    .filter((heading) => heading.level === CHAPTER_HEADING_LEVEL)
    .map((heading) => ({ title: heading.title, index: heading.start }))

  function chapterAt(pos: number): { title: string; order: number } {
    let title = '上卷'
    let order = 0
    for (let i = 0; i < chapters.length; i += 1) {
      if (chapters[i]!.index <= pos) {
        title = chapters[i]!.title
        order = i + 1
      }
    }
    return { title, order }
  }

  // 四级条文沿用原序号；自带正文的二/三级小节（产后总论、补集各方）接在其后编号，不挤占原 id；输出仍按原文顺序
  const sequenceByUnit = new Map<WikiHeadingUnit, number>()
  headers.forEach((unit, index) => sequenceByUnit.set(unit, index + 1))
  units
    .filter((unit) => unit.orphan)
    .forEach((unit, index) => sequenceByUnit.set(unit, headers.length + index + 1))
  assert.equal(sequenceByUnit.size, units.length, 'funvke: 每个切分单元都应有唯一序号')

  for (const header of units) {
    const sequence = sequenceByUnit.get(header)!
    const chap = chapterAt(header.start)
    const body = header.body
    if (body.length < MIN_UNIT_BODY_LENGTH) continue

    const clauseId = `funvke-${String(sequence).padStart(4, '0')}`
    const blocks = extractChenfuFormulaBlocks(body, {
      anonymousPrefix: header.title,
      lexicon,
    })

    const formulaIds: string[] = []
    let mainFormulaId: string | undefined
    for (let fi = 0; fi < blocks.length; fi += 1) {
      const block = blocks[fi]!
      const formulaId = `funvke-formula-${clauseId}-${fi + 1}`
      if (fi === 0) mainFormulaId = formulaId
      formulaIds.push(formulaId)
      formulas.push({
        id: formulaId,
        name: block.name,
        book: 'funvke',
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
      book: 'funvke',
      chapter: chap.title,
      chapterOrder: chap.order,
      order: sequence,
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
  await writeJson(path.join(outDir, 'funvke.json'), { clauses, formulas })

  const chapterCount = new Set(clauses.map((c) => c.chapter)).size
  return {
    clauses,
    formulas,
    stats: {
      chapterCount,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
    },
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('funvke.ts')) {
  runFunvkeParse()
    .then((r) => console.log('[funvke]', r.stats))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}

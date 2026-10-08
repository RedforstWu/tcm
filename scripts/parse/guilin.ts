import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import { extractFormulaBlocks, isFormulaNameLine, isPreparationLine } from '../lib/formula-parse.ts'
import { projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { cleanWikiMarkup, extractChapters, toSimplifiedChinese } from '../lib/wiki.ts'

function extractLeadingFormulaMentions(clauseText: string): string[] {
  const text = toSimplifiedChinese(clauseText)
  const names = new Set<string>()
  const re = /([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))(?:主之|方|。|$|，)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) names.add(match[1]!)
  const yi = text.match(/宜([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))/)
  if (yi?.[1]) names.add(yi[1])
  return [...names]
}

function shouldSkipLine(line: string): boolean {
  if (!line) return true
  if (isFormulaNameLine(line) || isPreparationLine(line)) return true
  if (/^右[一二三四五六七八九十]/.test(line) || /^上[一二三四五六七八九十]/.test(line)) return true
  if (
    line.length < 40 &&
    /[一二三四五六七八九十半\d]+(两|升|合|枚|分)/.test(line) &&
    !/主之|宜/.test(line)
  ) {
    return true
  }
  return false
}

function looksLikeNewClause(line: string): boolean {
  return /^(问曰|师曰|太阳|阳明|少阳|太阴|少阴|厥阴|伤寒|中风|病|脉|风家|病人|合病|并病|温病|伤暑|热病|湿病|伤燥|伤风|寒病)/.test(
    line,
  )
}

export interface GuilinParseResult {
  clauses: Clause[]
  formulas: Formula[]
  stats: { chapterCount: number; clauseCount: number; formulaCount: number }
}

export function parseGuilinWiki(raw: string): GuilinParseResult {
  const cleaned = cleanWikiMarkup(raw)
  let chapters = extractChapters(cleaned)
  if (chapters.length === 0) {
    // markdown 导出回退
    chapters = extractChapters(raw.replace(/^## /gm, '== ').replace(/^### /gm, '=== '))
  }

  const clauses: Clause[] = []
  const formulas: Formula[] = []
  const formulaByName = new Map<string, Formula>()
  let chapterOrder = 0
  let globalOrder = 0

  for (const chapter of chapters) {
    const chapterTitle = toSimplifiedChinese(chapter.title).trim()
    if (/序$/.test(chapterTitle) && chapterTitle.length < 20) continue
    chapterOrder += 1
    const body = toSimplifiedChinese(chapter.body)
    const blocks = extractFormulaBlocks(body)
    for (const block of blocks) {
      if (formulaByName.has(block.name)) continue
      const formula: Formula = {
        id: `guilin-formula-${block.name}`,
        name: block.name,
        book: 'guilin',
        herbs: block.herbs,
        preparation: block.preparation,
        modifications: block.modifications,
        sourceClauseIds: [],
        chapter: chapterTitle,
      }
      formulaByName.set(block.name, formula)
      formulas.push(formula)
    }

    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    let buffer: string[] = []
    const flush = () => {
      if (buffer.length === 0) return
      const text = buffer.join('')
      buffer = []
      if (text.length < 8 || isFormulaNameLine(text)) return
      globalOrder += 1
      const id = `guilin-${globalOrder}`
      const mentioned = extractLeadingFormulaMentions(text)
      const formulaIds: string[] = []
      for (const name of mentioned) {
        const formula = formulaByName.get(name)
        if (!formula) continue
        formulaIds.push(formula.id)
        if (!formula.sourceClauseIds.includes(id)) formula.sourceClauseIds.push(id)
      }
      clauses.push({
        id,
        book: 'guilin',
        chapter: chapterTitle,
        chapterOrder,
        order: globalOrder,
        text,
        formulaIds,
        symptomTags: [],
        pulseTags: [],
        channelTags: [],
        pathogenesisTags: [],
        reviewStatus: 'ai-draft',
      })
    }

    for (const line of lines) {
      if (shouldSkipLine(line)) continue
      if (buffer.length > 0 && looksLikeNewClause(line)) flush()
      buffer.push(line)
    }
    flush()
  }

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: chapterOrder,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
    },
  }
}

export async function runGuilinParse(): Promise<GuilinParseResult> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data/raw/guilin-guben.wiki'))
  const result = parseGuilinWiki(raw)
  await writeJson(path.join(root, 'data/parsed/guilin.json'), result)
  return result
}

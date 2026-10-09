import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import { CJK } from '../lib/cjk.ts'
import { extractFormulaBlocks, isFormulaNameLine, isPreparationLine } from '../lib/formula-parse.ts'
import { projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { cleanWikiMarkup, extractChapters, toSimplifiedChinese } from '../lib/wiki.ts'

const FORMULA_NAME_SUFFIX = '(?:汤|散|丸|膏|煎|饮子|饮|醴|酒)'
const BOOK_PREFIX = '(?:《[^》]{1,12}》)?'

/** 「矾石汤：治脚气冲心。」「《千金》三黄汤：治…」「《千金》甘草汤：」：方名与主治同行 */
const HEADER_WITH_TAIL_RE = new RegExp(
  `^${BOOK_PREFIX}([${CJK}]{2,24}?${FORMULA_NAME_SUFFIX})方?[：:](.*)$`,
)
/** 「蛇床子散方，温阴中坐药。」 */
const HEADER_COMMA_TAIL_RE = new RegExp(
  `^${BOOK_PREFIX}([${CJK}]{2,24}?${FORMULA_NAME_SUFFIX})方[，,](.+)$`,
)
/** 「治伤寒令愈不复，紫石寒食散方」：主治在前、方名在后 */
const HEADER_LEADING_INDICATION_RE = new RegExp(
  `^([^，。：:]{2,20})，([${CJK}]{2,24}?${FORMULA_NAME_SUFFIX})方[：:]?$`,
)
/** 篇中「附方：」「【附方】」标记行：不属于上一方的煎服法 */
const APPENDIX_MARKER_RE = /^【?附方】?[：:]?$/
/** 「救卒死方」「又方」「治食生肉中毒方」：以「方」收尾、不含句读的单方标题 */
const UNNAMED_RECIPE_HEADER_RE = /^[^，。；：:]{0,30}方[：:]?$/

/**
 * 把方剂标题统一成「方名方」独占一行，主治说明另起一行（主治行仍留在条文流中，与旧行为一致）。
 */
export function normalizeJinguiFormulaHeaders(body: string): string {
  const output: string[] = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (APPENDIX_MARKER_RE.test(line)) {
      output.push('')
      continue
    }
    if (isFormulaNameLine(line)) {
      output.push(line)
      continue
    }
    const leading = line.match(HEADER_LEADING_INDICATION_RE)
    if (leading) {
      // 主治移到方名之后，与「方名：主治」同形，避免被上一方的煎服法吞并
      output.push('', `${leading[2]!}方`, leading[1]!)
      continue
    }
    const tail = line.match(HEADER_WITH_TAIL_RE) ?? line.match(HEADER_COMMA_TAIL_RE)
    if (tail) {
      output.push(`${tail[1]!}方`)
      const rest = tail[2]!.trim()
      if (rest) output.push(rest)
      continue
    }
    // 杂疗篇「救卒死方」「又方」等无方名的单方：前置空行，使上一方的煎服法在此结束
    if (UNNAMED_RECIPE_HEADER_RE.test(line)) {
      output.push('', rawLine)
      continue
    }
    output.push(rawLine)
  }
  return output.join('\n')
}

/** 主篇（== 第N ==）之下的「附方」「附注」小节并回主篇，而不是整段丢弃 */
function extractJinguiChapters(cleaned: string): Array<{ title: string; body: string }> {
  const merged: Array<{ title: string; body: string }> = []
  for (const chapter of extractChapters(cleaned)) {
    const parent = merged[merged.length - 1]
    if (chapter.level > 2 && parent) {
      parent.body += `\n${chapter.body}`
      continue
    }
    merged.push({ title: chapter.title, body: chapter.body })
  }
  return merged.filter((chapter) => {
    const title = toSimplifiedChinese(chapter.title)
    return /第[一二三四五六七八九十]+|脉证|杂疗|禁忌/.test(title)
  })
}

function extractLeadingFormulaMentions(clauseText: string): string[] {
  const text = toSimplifiedChinese(clauseText)
  const names = new Set<string>()
  const re = /([\u4e00-\u9fff《》]{2,16}(?:汤|散|丸|膏|煎|饮))(?:主之|亦主之|方|。|$|，)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 6), match.index)
    if (/不可与|不得与|勿与|不可更行|禁与/.test(before)) continue
    names.add(match[1]!.replace(/《|》/g, ''))
  }
  const yiRe = /宜([\u4e00-\u9fff《》]{2,16}(?:汤|散|丸|膏|煎|饮))/g
  while ((match = yiRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 4), match.index)
    if (/不可|不得|勿/.test(before)) continue
    names.add(match[1]!.replace(/《|》/g, ''))
  }
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
  return /^(问曰|师曰|太阳|阳明|少阳|太阴|少阴|厥阴|病|脉|夫|妇人|腹痛|咳|呕|黄疸|水气|痰饮|胸痹|奔豚|百合|疟|中风|历节|血痹|虚劳|肺痿|肺痈)/.test(
    line,
  )
}

export interface JinguiParseStats {
  chapterCount: number
  clauseCount: number
  formulaCount: number
  /** 组成为空的方剂数 */
  emptyHerbFormulaCount: number
  /** 因无法经 herb-lexicon 解析而未放进 herbs 的药味数 */
  unresolvedHerbTokenCount: number
  /** 方名 → 未能解析的药味原文 */
  unresolvedHerbTokens: Record<string, string[]>
}

export interface JinguiParseResult {
  clauses: Clause[]
  formulas: Formula[]
  stats: JinguiParseStats
}

export function parseJinguiWiki(raw: string): JinguiParseResult {
  const cleaned = cleanWikiMarkup(raw)
  const chapters = extractJinguiChapters(cleaned)

  const clauses: Clause[] = []
  const formulas: Formula[] = []
  const formulaByName = new Map<string, Formula>()
  const unresolvedHerbTokens: Record<string, string[]> = {}
  let chapterOrder = 0

  for (const chapter of chapters) {
    chapterOrder += 1
    const chapterTitle = toSimplifiedChinese(chapter.title).trim()
    // 规范化 wiki 加粗方名行：:'''桂枝加龙骨牡蛎汤方：''' / 甘草粉蜜汤方*
    const clauseBody = toSimplifiedChinese(chapter.body)
      .replace(/:'{2,3}/g, '\n')
      .replace(/'{2,3}/g, '')
      .replace(/方\*/g, '方')
      .replace(/方：/g, '方\n')
    const body = normalizeJinguiFormulaHeaders(clauseBody)
    const blocks = extractFormulaBlocks(body, {
      requireKnownHerb: true,
      stopAtBlankLineAfterPreparation: true,
    })
    // 方剂消费过的药味 / 煎服法行不再并入条文（方名行由 shouldSkipLine 跳过，主治行仍保留）
    const consumedLines = new Set<string>()
    for (const block of blocks) {
      for (const sourceLine of block.sourceLines) consumedLines.add(sourceLine)
      const name = block.name
      if (formulaByName.has(name)) continue
      const formula: Formula = {
        id: `jingui-formula-${name}`,
        name,
        book: 'jingui',
        herbs: block.herbs,
        preparation: block.preparation,
        modifications: block.modifications,
        sourceClauseIds: [],
        chapter: chapterTitle,
      }
      if (block.unresolvedHerbTokens.length > 0) {
        unresolvedHerbTokens[name] = block.unresolvedHerbTokens
      }
      formulaByName.set(name, formula)
      formulas.push(formula)
    }

    // 条文流用标题拆分前的正文：「矾石汤：治脚气冲心。」保留方名与主治同行
    const lines = clauseBody
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    let buffer: string[] = []
    let orderInChapter = 0

    const flush = () => {
      if (buffer.length === 0) return
      const text = buffer.join('')
      buffer = []
      if (text.length < 8 || isFormulaNameLine(text)) return
      orderInChapter += 1
      const id = `jingui-${chapterOrder}-${orderInChapter}`
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
        book: 'jingui',
        chapter: chapterTitle,
        chapterOrder,
        order: orderInChapter,
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
      if (shouldSkipLine(line) || consumedLines.has(line)) continue
      if (buffer.length > 0 && looksLikeNewClause(line)) flush()
      buffer.push(line)
    }
    flush()
  }

  const unresolvedHerbTokenCount = Object.values(unresolvedHerbTokens).reduce(
    (sum, tokens) => sum + tokens.length,
    0,
  )
  return {
    clauses,
    formulas,
    stats: {
      chapterCount: chapterOrder,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
      emptyHerbFormulaCount: formulas.filter((formula) => formula.herbs.length === 0).length,
      unresolvedHerbTokenCount,
      unresolvedHerbTokens,
    },
  }
}

/** 单本解析结束时的诊断汇总 */
export function formatJinguiParseSummary(stats: JinguiParseStats): string {
  const lines = [
    `[jingui] 方剂 ${stats.formulaCount}，空药味方剂 ${stats.emptyHerbFormulaCount}，未解析药味 ${stats.unresolvedHerbTokenCount}`,
  ]
  for (const [name, tokens] of Object.entries(stats.unresolvedHerbTokens)) {
    lines.push(`  - ${name}: ${tokens.join('、')}`)
  }
  return lines.join('\n')
}

export async function runJinguiParse(): Promise<JinguiParseResult> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data/raw/jingui-yaolue.wiki'))
  const result = parseJinguiWiki(raw)
  console.log(formatJinguiParseSummary(result.stats))
  await writeJson(path.join(root, 'data/parsed/jingui.json'), result)
  return result
}

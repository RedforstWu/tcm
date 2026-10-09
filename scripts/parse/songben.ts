import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import {
  extractFormulaBlocks,
  isFormulaNameLine,
  isPreparationLine,
  parseFormulaHeading,
  parseModifications,
} from '../lib/formula-parse.ts'
import assert from 'node:assert/strict'
import { applyErrata, loadErrata } from '../lib/errata.ts'
import { fileExists, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { cleanWikiMarkup, extractChapters, normalizeForCompare, toSimplifiedChinese } from '../lib/wiki.ts'

/** 通行宋本（赵开美本）条文编号总数；解析结果必须与之一致，否则下游 songben-N 编号全部错位 */
export const SONGBEN_CLAUSE_COUNT = 398

export const SONGBEN_BOOK_ID = 'songben'

interface SongbenFormulaAlias {
  /** 条文中的写法 */
  alias: string
  /** 本书方题方名 */
  canonical: string
  /** 条文同时出现这些全称时，简称可能另有所指，不解析 */
  conflictingNames?: string[]
}

/**
 * 条文方名简称 / 异写 → 方题方名（仅限宋本语境，精确匹配，不做模糊）。
 * - 柴胡汤：第 98「与柴胡汤」、101「复与柴胡汤」、149「复与柴胡汤」，指小柴胡汤
 * - 栀子柏皮汤：第 261 条作「栀子柏皮汤主之」，方题作「栀子檗皮汤方」
 * - 麻黄杏子甘草石膏汤：第 162 条「可与麻黄杏子甘草石膏汤」，方题（第 63 条后）作「麻黄杏仁甘草石膏汤方」
 * - 三物小陷胸汤 / 白散：第 141 条「与三物小陷胸汤，白散亦可服」，方题作「小陷胸汤方」「三物小白散方」
 */
const SONGBEN_FORMULA_ALIASES: readonly SongbenFormulaAlias[] = [
  {
    alias: '柴胡汤',
    canonical: '小柴胡汤',
    conflictingNames: ['大柴胡汤', '柴胡桂枝汤', '柴胡桂枝干姜汤', '柴胡加芒硝汤', '柴胡加龙骨牡蛎汤'],
  },
  { alias: '栀子柏皮汤', canonical: '栀子檗皮汤' },
  { alias: '麻黄杏子甘草石膏汤', canonical: '麻黄杏仁甘草石膏汤' },
  { alias: '三物小陷胸汤', canonical: '小陷胸汤' },
  { alias: '白散', canonical: '三物小白散' },
]

const ALIAS_BY_NAME = new Map(SONGBEN_FORMULA_ALIASES.map((entry) => [entry.alias, entry]))

/**
 * 处方语气补充句式（方名在捕获组 1；允许「白散」这类两字方名）：
 * 第 29「更作芍药甘草汤与之」、39「大青龙汤发之」、18「桂枝汤加厚朴、杏子佳」、
 * 251「以小承气汤少少与」、356「当服茯苓甘草汤」、141「白散亦可服」
 */
const PRESCRIPTION_PHRASE_PATTERNS: readonly RegExp[] = [
  /作([\u4e00-\u9fff]{1,12}(?:汤|散|丸|膏|煎|饮))与之/g,
  /([\u4e00-\u9fff]{1,12}(?:汤|散|丸|膏|煎|饮))发之/g,
  /([\u4e00-\u9fff]{1,12}汤)加[\u4e00-\u9fff、]+佳/g,
  /以([\u4e00-\u9fff]{1,12}(?:汤|散|丸|膏|煎|饮))少少与/g,
  /当服([\u4e00-\u9fff]{1,12}(?:汤|散|丸|膏|煎|饮))/g,
  /([\u4e00-\u9fff]{1,12}(?:汤|散|丸|膏|煎|饮))亦可服/g,
]

/** 分句边界：否定 / 禁用语只在方名所在分句内生效（「不可下，宜麻黄汤」的「不可」管「下」不管方） */
const CLAUSE_SEGMENT_BREAK_RE = /[，。；：、？！]/
/** 方名前回看字数 */
const NEGATION_LOOKBEHIND_LONG = 6
const NEGATION_LOOKBEHIND_SHORT = 4

/** 方剂小标题：烧裈散方 / 猪胆汁方（附方）/ 土瓜根方（附方佚）/ 蜜煎导方 */
const FORMULA_HEADING_RE = /^([\u4e00-\u9fff]{2,16}?)方(?:[（(][^）)]*[）)])?$/

/** 条文病证叙述标记；方后制法段不含这些字眼 */
const CLAUSE_NARRATIVE_RE =
  /脉|病|证|主之|宜|者|汗|热|寒|厥|呕|吐|渴|烦|痛|满|悸|咳|喘|谵语|下之|不可|愈|死|治/

/** 「药名+剂量」起头，如「大猪胆一枚」 */
const HERB_DOSE_START_RE =
  /^[\u4e00-\u9fff]{1,8}?[一二三四五六七八九十百半]+(?:两|升|合|枚|铢|斤|个|箇|茎|分|片)/

/** 制法 / 用法动作 */
const PREPARATION_ACTION_RE = /取|烧|作灰|捣|筛|煮|煎|泻汁|绞汁|灌|内|服|方寸匕|为末|为散|为丸|研/

/**
 * 方后注 / 制法段（内容判据）：无病证叙述，且以「药名+剂量」起头或含制法动作。
 * 解析时还须满足上下文判据：位于方剂小标题之后、下一条文之前。
 */
export function isFormulaAppendixText(line: string): boolean {
  const text = toSimplifiedChinese(line).trim()
  if (!text || CLAUSE_NARRATIVE_RE.test(text)) return false
  return HERB_DOSE_START_RE.test(text) || PREPARATION_ACTION_RE.test(text)
}

/** 方剂小标题 → 方名；非标题返回 null */
export function resolveFormulaHeading(line: string): string | null {
  const text = toSimplifiedChinese(line).trim()
  const heading = parseFormulaHeading(text)
  if (heading) return heading.name
  const match = text.match(FORMULA_HEADING_RE)
  return match ? match[1]! : null
}

export interface SongbenFormulaAppendix {
  /** 方剂小标题所属的前一条文 */
  ownerClauseId: string | null
  /** 小标题解析出的方名 */
  formulaName: string
  /** 已建模时并入的方剂 id；未单独建模为 null */
  formulaId: string | null
  text: string
}

/** 方剂诊断说明（Formula 类型无 note 字段，记在解析结果里） */
export interface SongbenFormulaNote {
  formulaId: string
  formulaName: string
  note: string
}

export function assertSongbenClauseCount(clauseCount: number, expected = SONGBEN_CLAUSE_COUNT): void {
  if (clauseCount !== expected) {
    throw new Error(
      `[songben] 条文数 ${clauseCount} ≠ 通行宋本 ${expected}：检查方后注/制法段是否被误切为条文，或真条文被误并`,
    )
  }
}

interface NumberedChapterDef {
  key: string
  test: (title: string) => boolean
}

const NUMBERED_CHAPTERS: NumberedChapterDef[] = [
  { key: '辨太阳病脉证并治上', test: (t) => t.includes('太阳') && t.includes('上') },
  { key: '辨太阳病脉证并治中', test: (t) => t.includes('太阳') && t.includes('中') },
  { key: '辨太阳病脉证并治下', test: (t) => t.includes('太阳') && t.includes('下') },
  { key: '辨阳明病脉证并治', test: (t) => t.includes('阳明') },
  { key: '辨少阳病脉证并治', test: (t) => t.includes('少阳') },
  { key: '辨太阴病脉证并治', test: (t) => t.includes('太阴') },
  { key: '辨少阴病脉证并治', test: (t) => t.includes('少阴') },
  { key: '辨厥阴病脉证并治', test: (t) => t.includes('厥阴') },
  { key: '辨霍乱病脉证并治', test: (t) => t.includes('霍乱') },
  {
    key: '辨阴阳易差后劳复病脉证并治',
    test: (t) => t.includes('阴阳易') || (t.includes('差后') && t.includes('劳复')),
  },
]

function resolveNumberedChapter(title: string): string | null {
  const simplified = toSimplifiedChinese(title)
  if (simplified.includes('痉湿暍')) return null
  if (
    simplified.includes('不可') ||
    simplified.includes('可发汗') ||
    simplified.includes('可吐') ||
    simplified.includes('可下') ||
    simplified.includes('发汗后') ||
    simplified.includes('发汗吐下后')
  ) {
    return null
  }
  for (const chapter of NUMBERED_CHAPTERS) {
    if (chapter.test(simplified)) return chapter.key
  }
  return null
}

function inferChannel(chapter: string): string[] {
  // 仅六经；霍乱等病篇不归入经络标签
  for (const name of ['太阳', '阳明', '少阳', '太阴', '少阴', '厥阴']) {
    if (chapter.includes(name)) return [name]
  }
  return []
}

/** endIndex 之前、同一分句内的至多 maxLength 字 */
function sameSegmentPrefix(text: string, endIndex: number, maxLength: number): string {
  const window = text.slice(Math.max(0, endIndex - maxLength), endIndex)
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (CLAUSE_SEGMENT_BREAK_RE.test(window[index]!)) return window.slice(index + 1)
  }
  return window
}

function extractLeadingFormulaMentions(clauseText: string): string[] {
  const text = toSimplifiedChinese(clauseText)
  const names = new Set<string>()
  const re = /([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))(?:主之|方|。|$|，)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const before = sameSegmentPrefix(text, match.index, NEGATION_LOOKBEHIND_LONG)
    if (/不可与|不得与|勿与|不可更行|禁与/.test(before)) continue
    names.add(match[1]!)
  }
  // 「宜X / 宜服X」
  const yiRe = /(?:^|[^不])宜服?([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))/g
  while ((match = yiRe.exec(text)) !== null) {
    const keywordIndex = match.index + match[0].indexOf('宜')
    const before = sameSegmentPrefix(text, keywordIndex, NEGATION_LOOKBEHIND_SHORT)
    if (/不可|不得|勿/.test(before)) continue
    names.add(match[1]!)
  }
  // 「与/可与/当与」正向
  const yuRe = /(?:可与|当与|与)([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))/g
  while ((match = yuRe.exec(text)) !== null) {
    const before = sameSegmentPrefix(text, match.index, NEGATION_LOOKBEHIND_SHORT)
    if (/不可|不得|勿/.test(before)) continue
    names.add(match[1]!)
  }
  for (const pattern of PRESCRIPTION_PHRASE_PATTERNS) {
    pattern.lastIndex = 0
    while ((match = pattern.exec(text)) !== null) {
      const before = sameSegmentPrefix(text, match.index, NEGATION_LOOKBEHIND_LONG)
      if (/不可|不得|勿|禁/.test(before)) continue
      names.add(match[1]!)
    }
  }
  return [...names]
}

/** 条文方名 → 本书方剂：先按方题全称，再查显式别名表 */
function resolveMentionedFormula(
  mentionedName: string,
  clauseText: string,
  formulaByName: ReadonlyMap<string, Formula>,
): Formula | null {
  const direct = formulaByName.get(mentionedName)
  if (direct) return direct
  const alias = ALIAS_BY_NAME.get(mentionedName)
  if (!alias) return null
  if (alias.conflictingNames?.some((fullName) => clauseText.includes(fullName))) return null
  return formulaByName.get(alias.canonical) ?? null
}

function shouldSkipLine(line: string): boolean {
  if (!line) return true
  if (isFormulaNameLine(line) || isPreparationLine(line)) return true
  if (/^右[一二三四五六七八九十]/.test(line) || /^上[一二三四五六七八九十]/.test(line)) return true
  if (/^服已须臾|^温覆|^若一服|^禁生冷|^余如桂枝|^以水|^咬咀|^㕮咀|^每服/.test(line)) return true
  // 方剂组成残行（如「芍药甘草炙各四两」）
  if (/各[一二三四五六七八九十半\d]+(两|升|合|枚)/.test(line) && !/主之|宜/.test(line) && !/。/.test(line)) {
    return true
  }
  if (
    /[一二三四五六七八九十半\d]+(两|升|合|枚|铢)/.test(line) &&
    !/。|主之|宜|问曰|师曰|名为|名曰/.test(line) &&
    !/^(太阳|阳明|少阳|太阴|少阴|厥阴|伤寒|病人)/.test(line)
  ) {
    return true
  }
  // 条文应具备叙述标记
  if (!/。|主之|宜|问曰|师曰|名为|名曰|者$|也$/.test(line)) {
    return true
  }
  return line.length < 6
}

export async function loadHuxishuOpenings(): Promise<string[]> {
  const root = projectRoot()
  const candidates = [
    path.join(root, '.agents/skills/huxishu/modules/01_shanghan.md'),
    path.join(root, 'huxishu/modules/01_shanghan.md'),
  ]
  let content = ''
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      content = await readText(candidate)
      break
    }
  }
  if (!content) return []

  // 只取伤寒论部分（金匮在后半）
  const shanghanPart = content.split(/# 胡希恕《金匮要略》/)[0] ?? content
  const openings: string[] = []
  const re = /### 第(\d+)条\s*\n+([\s\S]*?)(?=\n### 第\d+条|\n## |\n# |$)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(shanghanPart)) !== null) {
    const body = match[2]!.trim()
    const firstLine = body.split('\n').find((line) => line.trim()) ?? ''
    let text = firstLine.replace(/^伤寒论第\d+条/, '').trim()
    // 截断白话讲解
    text = text.split(
      /今天|咱们|那么|这个|就是|什么叫|开始研究|上面说|这一条|这段|所谓|实际上|咱们前面/,
    )[0] ?? text
    openings.push(normalizeForCompare(text).slice(0, 48))
  }
  return openings
}

export interface SongbenParseResult {
  clauses: Clause[]
  formulas: Formula[]
  validation: {
    clauseCount: number
    expected: number
    huxishuMatched: number
    huxishuTotal: number
    mismatches: Array<{ order: number; songben: string; huxishu?: string }>
    formulaAppendices: SongbenFormulaAppendix[]
    formulaNotes: SongbenFormulaNote[]
  }
}

export interface SongbenParseOptions {
  /** 期望条文数；null 表示不校验（仅供片段级单测） */
  expectedClauseCount?: number | null
}

function mergeAppendixIntoFormula(formula: Formula, text: string, afterPreparation: boolean): void {
  if (formula.preparation.includes(text)) return
  if (text.includes(formula.preparation)) {
    // 「大猪胆一枚，泻汁，和少许法醋……」：方剂解析已从同一行拆出制法，整行替换以免重复
    formula.preparation = text
  } else {
    formula.preparation = afterPreparation ? `${formula.preparation}${text}` : `${text}${formula.preparation}`
  }
  formula.modifications = parseModifications(formula.preparation)
}

function linkFormulaToClause(formula: Formula, clause: Clause): void {
  if (!formula.sourceClauseIds.includes(clause.id)) formula.sourceClauseIds.push(clause.id)
  if (!clause.formulaIds.includes(formula.id)) clause.formulaIds.push(formula.id)
}

export function parseSongbenWiki(
  raw: string,
  options: SongbenParseOptions = {},
): {
  clauses: Clause[]
  formulas: Formula[]
  numberedClauseTexts: string[]
  formulaAppendices: SongbenFormulaAppendix[]
  formulaNotes: SongbenFormulaNote[]
} {
  const expectedClauseCount =
    options.expectedClauseCount === undefined ? SONGBEN_CLAUSE_COUNT : options.expectedClauseCount
  const cleaned = cleanWikiMarkup(raw)
  const chapters = extractChapters(cleaned)
  const clauses: Clause[] = []
  const formulas: Formula[] = []
  const formulaByName = new Map<string, Formula>()
  let chapterOrder = 0
  let clauseOrder = 0
  const numberedClauseTexts: string[] = []
  const formulaAppendices: SongbenFormulaAppendix[] = []
  const formulaNotes: SongbenFormulaNote[] = []
  /** 方名 → 其小标题前的条文（首次出现） */
  const headingOwnerByFormulaName = new Map<string, Clause>()
  const seenChapterKeys = new Set<string>()

  for (const chapter of chapters) {
    const numberedKey = resolveNumberedChapter(chapter.title)
    if (!numberedKey) continue
    if (seenChapterKeys.has(numberedKey)) continue
    seenChapterKeys.add(numberedKey)
    chapterOrder += 1

    const simplifiedBody = toSimplifiedChinese(chapter.body)
    const blocks = extractFormulaBlocks(simplifiedBody)
    for (const block of blocks) {
      if (formulaByName.has(block.name)) continue
      const formula: Formula = {
        id: `songben-formula-${block.name}`,
        name: block.name,
        book: 'songben',
        herbs: block.herbs,
        preparation: block.preparation,
        modifications: block.modifications,
        sourceClauseIds: [],
        chapter: numberedKey,
      }
      formulaByName.set(block.name, formula)
      formulas.push(formula)
      if (block.lost) {
        formulaNotes.push({
          formulaId: formula.id,
          formulaName: block.name,
          note: `原方佚（小标题注「${block.headingNote ?? ''}」）：组成不可考，herbs 留空`,
        })
      }
    }

    // 宋本维基：一条一自然段/一行
    const lines = simplifiedBody
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)

    // 方剂小标题之后、下一条文之前的区段
    let formulaSection: {
      formulaName: string
      formula: Formula | null
      ownerClauseId: string | null
      seenPreparation: boolean
    } | null = null

    for (const rawLine of lines) {
      // 去掉条首数目（如「一五八」「第158条」）与校注残句
      let line = rawLine
        .replace(/^[一二三四五六七八九十百零〇]+、?/, '')
        .replace(/^第?\d+条?/, '')
        .trim()
      if (/本云|同体别名|疑非|见《/.test(line) && !/主之|宜/.test(line)) continue
      const headingName = resolveFormulaHeading(line)
      if (headingName) {
        const ownerClause = clauses.at(-1)
        if (ownerClause && !headingOwnerByFormulaName.has(headingName)) {
          headingOwnerByFormulaName.set(headingName, ownerClause)
        }
        formulaSection = {
          formulaName: headingName,
          formula: formulaByName.get(headingName) ?? null,
          ownerClauseId: ownerClause?.id ?? null,
          seenPreparation: false,
        }
        continue
      }
      if (formulaSection && isPreparationLine(line)) formulaSection.seenPreparation = true
      if (shouldSkipLine(line)) continue
      if (formulaSection && isFormulaAppendixText(line)) {
        if (formulaSection.formula) {
          mergeAppendixIntoFormula(formulaSection.formula, line, formulaSection.seenPreparation)
        }
        formulaAppendices.push({
          ownerClauseId: formulaSection.ownerClauseId,
          formulaName: formulaSection.formulaName,
          formulaId: formulaSection.formula?.id ?? null,
          text: line,
        })
        continue
      }
      formulaSection = null
      clauseOrder += 1
      const id = `songben-${clauseOrder}`
      const mentioned = extractLeadingFormulaMentions(line)
      const formulaIds: string[] = []
      for (const name of mentioned) {
        const formula = resolveMentionedFormula(name, line, formulaByName)
        if (!formula || formulaIds.includes(formula.id)) continue
        formulaIds.push(formula.id)
        if (!formula.sourceClauseIds.includes(id)) formula.sourceClauseIds.push(id)
      }
      clauses.push({
        id,
        book: 'songben',
        chapter: numberedKey,
        chapterOrder,
        order: clauseOrder,
        text: line,
        formulaIds,
        symptomTags: [],
        pulseTags: [],
        channelTags: inferChannel(numberedKey),
        pathogenesisTags: numberedKey.includes('霍乱') ? ['霍乱'] : [],
        reviewStatus: 'ai-draft',
      })
      numberedClauseTexts.push(line)
    }
  }

  // 条文未以「X主之 / 宜X」点名的方（「宜蜜煎导而通之，若土瓜根及大猪胆汁，皆可为导」）：
  // 小标题前一条文原文含方名时，归属该条文
  for (const formula of formulas) {
    if (formula.sourceClauseIds.length > 0) continue
    const ownerClause = headingOwnerByFormulaName.get(formula.name)
    if (ownerClause?.text.includes(formula.name)) linkFormulaToClause(formula, ownerClause)
  }

  if (expectedClauseCount !== null) assertSongbenClauseCount(clauses.length, expectedClauseCount)
  return { clauses, formulas, numberedClauseTexts, formulaAppendices, formulaNotes }
}

export async function runSongbenParse(): Promise<SongbenParseResult> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data/raw/songben-shanghan.wiki'))
  const errata = await loadErrata(SONGBEN_BOOK_ID)
  const { text: correctedRaw, applied } = applyErrata(raw, errata)
  console.info(`[songben] 已应用勘误 ${applied.length}/${errata.length} 条`)
  const parsed = parseSongbenWiki(correctedRaw)
  parsed.clauses.forEach((clause, index) => {
    assert.equal(clause.id, `songben-${index + 1}`, `[songben] 第 ${index + 1} 条 id 错位：${clause.id}`)
  })
  const openings = await loadHuxishuOpenings()
  const mismatches: SongbenParseResult['validation']['mismatches'] = []
  let matched = 0

  for (let i = 0; i < Math.min(parsed.numberedClauseTexts.length, openings.length); i += 1) {
    const song = normalizeForCompare(parsed.numberedClauseTexts[i]!).slice(0, 28)
    const hu = openings[i]!.slice(0, 28)
    if (!hu) continue
    if (song.includes(hu.slice(0, 10)) || hu.includes(song.slice(0, 10)) || similar(song, hu)) {
      matched += 1
    } else if (mismatches.length < 40) {
      mismatches.push({ order: i + 1, songben: song, huxishu: hu })
    }
  }

  const result: SongbenParseResult = {
    clauses: parsed.clauses,
    formulas: parsed.formulas,
    validation: {
      clauseCount: parsed.clauses.length,
      expected: SONGBEN_CLAUSE_COUNT,
      huxishuMatched: matched,
      huxishuTotal: openings.length,
      mismatches,
      formulaAppendices: parsed.formulaAppendices,
      formulaNotes: parsed.formulaNotes,
    },
  }
  await writeJson(path.join(root, 'data/parsed/songben.json'), result)
  return result
}

function similar(a: string, b: string): boolean {
  const n = Math.min(16, a.length, b.length)
  if (n < 8) return false
  let hit = 0
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) hit += 1
  }
  return hit / n >= 0.7
}

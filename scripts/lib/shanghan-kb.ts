import type { BookId } from '../../src/types/books.generated.ts'
import {
  extractBacktickSpans,
  extractBlockquoteLines,
  extractListItems,
  findSectionByPrefix,
  getSection,
  parseMarkdownWithFrontmatter,
  parseWikilink,
  splitSections,
  stripWikilinks,
  wikilinkBasename,
  type FrontmatterData,
} from './markdown-frontmatter.ts'

/**
 * yanghuide13350/shanghan-lun-knowledge-base（下称 KB）卡片 → 中间 JSON。
 * KB 全部标注「待核」，是候选标注来源而非真值：这里只做忠实转换与规范化，不做裁决。
 */

export const KB_SOURCE_REPO = 'https://github.com/yanghuide13350/shanghan-lun-knowledge-base'
/** 导入时核对过的 KB 版本；vendor 目录 HEAD 与此不符时记 warning */
export const KB_PINNED_COMMIT = 'e184b49121d290950abdc80b98c9de4b23de7b86'
export const KB_SOURCE_ID_PREFIX = 'shanghan-kb'
/** KB 仓库内的内容根目录；所有 locator 相对于它 */
export const KB_CONTENT_DIR = '伤寒论知识库'
/** KB 未声明 LICENSE */
export const KB_LICENSE = 'unspecified'

/** KB 用作"待核"占位的取值 */
export const PENDING_VALUE = '待核'
export const SONGBEN_CLAUSE_FIRST = 1
export const SONGBEN_CLAUSE_LAST = 398
export const SIX_CHANNEL_NAMES = ['太阳病', '阳明病', '少阳病', '太阴病', '少阴病', '厥阴病'] as const

export const KB_SECTIONS = {
  clauses: { dir: '01_条文', cardType: '条文' },
  formulas: { dir: '02_方剂', cardType: '方剂' },
  herbs: { dir: '03_药物', cardType: '药物' },
  syndromes: { dir: '04_证型', cardType: '证型' },
  commentaries: { dir: '99_解读/注家', cardType: '解读' },
} as const

export type KbSectionKey = keyof typeof KB_SECTIONS
export const KB_SECTION_KEYS = Object.keys(KB_SECTIONS) as KbSectionKey[]

/** 出处片段 → bookId；按片段前缀匹配（`桂林古本伤寒杂病论`、`桂林古本（条文）` 均归 guilin） */
export const SOURCE_BOOK_PREFIXES: ReadonlyArray<{ prefix: string; bookId: BookId }> = [
  { prefix: '伤寒论', bookId: 'songben' },
  { prefix: '金匮要略', bookId: 'jingui' },
  { prefix: '桂林古本', bookId: 'guilin' },
]

const SOURCE_SEGMENT_SEPARATOR = /[；;、，,]/
const EVIDENCE_LOCATOR_SEPARATOR = /[；;]/
const TERM_SEPARATOR = /[、，,]/
const CHANNEL_SUFFIX = '经'
const CLAUSE_FILE_PATTERN = /条文-(\d+)\.md$/
const CLAUSE_LINK_PATTERN = /条文-(\d+)/
const SONGBEN_CLAUSE_REF_PATTERN = /^\d+$/
const SONGBEN_FORMULA_REF_PATTERN = /^方(\d+)$/
/** 汉代剂量以数量/修治字起头时，判为省略了药名（而非药名不一致） */
const DOSE_QUANTITY_LEAD = /^[一二三四五六七八九十百千半两分铢升合斤枚个]/

// ---------- 输出类型 ----------

export interface KbWarning {
  path: string
  message: string
}

export interface KbSkipped {
  path: string
  reason: string
}

export interface KbClause {
  number: number
  sixChannel: string | null
  chapter: string | null
  edition: string | null
  kangpingLayer: string | null
  versionDisputed: boolean | null
  formulaNames: string[]
  symptomLabels: string[]
  /** `## 原文（宋版）` 引用块，多行以换行拼接，保留原标点 */
  text: string | null
  verifyStatus: string | null
  locator: string
}

export interface KbFormulaHerb {
  /** 组成中的药名（已去 wikilink） */
  name: string
  /** 汉代剂量原文（含药名前缀，如 `桂枝三两去皮`） */
  doseRaw: string | null
  /** 去掉药名前缀后的剂量；未以药名开头时等于 doseRaw */
  doseText: string | null
  /** 药物链接指向的药物卡名（如 乌头 → 川乌）；非链接时为 null */
  herbCard: string | null
  /** 药物链接为非链接说明文字时（如 `蜂蜜（食材/辅料，不建药物卡）`）保留原文 */
  herbLinkNote: string | null
}

export interface KbEvidenceLocator {
  path: string
  line: number | null
}

export interface KbFormula {
  name: string
  aliases: string[]
  sourceRaw: string | null
  sourceBooks: BookId[]
  /** 原文编号原值（统一为字符串） */
  sourceRefsRaw: string[]
  /** 原文编号中的纯数字项（宋本条文号），仅当出处含伤寒论时解析 */
  clauseNumbers: number[]
  /** 原文编号中的 `方N` 项（宋本方号） */
  songbenFormulaNumbers: number[]
  dosageForm: string | null
  herbs: KbFormulaHerb[]
  /** frontmatter 煎服法；缺失时取正文 */
  preparation: string | null
  /** 正文 `## 煎服法` 与 frontmatter 不一致时保留正文版本，否则为 null */
  preparationBody: string | null
  indications: string | null
  keySymptoms: string[]
  contraindications: string[]
  toxicHerbs: string[]
  safetyLevel: string | null
  verifyStatus: string | null
  evidenceLocators: KbEvidenceLocator[]
  relatedFormulas: string[]
  /** KB 的 折算剂量 不导出，只记录是否存在 */
  hasConvertedDose: boolean
  locator: string
}

export interface KbHerbSource {
  kind: string
  text: string
}

export interface KbHerb {
  name: string
  pharmacopoeiaName: string | null
  aliases: string[]
  pinyin: string | null
  latin: string | null
  /** 全部为「待核」时为 null */
  natureFlavor: string[] | null
  channels: string[] | null
  toxic: boolean | null
  modernDose: string | null
  sources: KbHerbSource[]
  verifyStatus: string | null
  locator: string
}

export interface KbSyndromeDifferential {
  target: string
  note: string | null
}

export interface KbSyndrome {
  name: string
  sixChannel: string | null
  nature: string[]
  mainFormulas: string[]
  clauseNumbers: number[]
  mainSymptoms: string[]
  tongueAndPulse: { pulse: string | null; tongue: string | null }
  differentials: KbSyndromeDifferential[]
  definition: string | null
  locator: string
}

export interface KbCommentary {
  commentator: string | null
  sourceBook: string | null
  clauseNumber: number
  formulaNames: string[]
  /** `## 原文依据` 中反引号内的古籍原句（繁体原样） */
  quotes: string[]
  /** `## 解读提要`：KB 作者的现代转述 */
  summary: string | null
  /** KB `状态` 字段（如 旁参：非逐条直注） */
  status: string | null
  /** summary 属现代转述且 KB 未声明许可 */
  licenseRestricted: true
  locator: string
}

export interface KbCard {
  locator: string
  data: FrontmatterData
  body: string
}

export interface ConvertResult<T> {
  record: T | null
  warnings: KbWarning[]
  /** record 为 null 时的跳过原因 */
  skipReason?: string
}

export interface KbRawFile {
  section: KbSectionKey
  /** 相对 KB_CONTENT_DIR 的路径，使用 `/` 分隔 */
  locator: string
  text: string
}

export interface KbDataset {
  clauses: KbClause[]
  formulas: KbFormula[]
  herbs: KbHerb[]
  syndromes: KbSyndrome[]
  commentaries: KbCommentary[]
  skipped: KbSkipped[]
  warnings: KbWarning[]
}

// ---------- 通用工具 ----------

const zhCollator = new Intl.Collator('zh-Hans-CN')

/** zh 排序，collator 相等时按码点兜底，保证结果稳定 */
export function compareZh(left: string, right: string): number {
  const collated = zhCollator.compare(left, right)
  if (collated !== 0) return collated
  if (left === right) return 0
  return left < right ? -1 : 1
}

function uniqueInOrder<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** wikilink → 目标卡名（路径末段）；非链接时去 wikilink 后原样返回 */
export function linkTargetName(raw: string): string {
  const link = parseWikilink(raw)
  if (link) return wikilinkBasename(link.target)
  return stripWikilinks(raw).trim()
}

function clauseNumberFromLink(raw: string): number | null {
  const link = parseWikilink(raw)
  const candidates = link ? [wikilinkBasename(link.target), link.display] : [raw]
  for (const candidate of candidates) {
    const match = CLAUSE_LINK_PATTERN.exec(candidate)
    if (match) return Number(match[1])
  }
  return null
}

function clauseNumberFromLocator(locator: string): number | null {
  const match = CLAUSE_FILE_PATTERN.exec(locator)
  return match ? Number(match[1]) : null
}

function isSongbenClauseNumber(value: number): boolean {
  return Number.isInteger(value) && value >= SONGBEN_CLAUSE_FIRST && value <= SONGBEN_CLAUSE_LAST
}

function pendingToNull(value: string | null): string | null {
  return value === PENDING_VALUE ? null : value
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

/** 读取 frontmatter 字段并对类型/缺失记 warning */
class CardFieldReader {
  readonly warnings: KbWarning[] = []
  private readonly card: KbCard

  constructor(card: KbCard) {
    this.card = card
  }

  warn(message: string): void {
    this.warnings.push({ path: this.card.locator, message })
  }

  private raw(key: string, required: boolean): unknown {
    const value = this.card.data[key]
    if ((value === undefined || value === null) && required) this.warn(`缺少必需字段「${key}」`)
    return value
  }

  string(key: string, required = false): string | null {
    const value = this.raw(key, required)
    if (value === undefined || value === null) return null
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value !== 'string') {
      this.warn(`字段「${key}」应为字符串，实际为 ${describeType(value)}`)
      return null
    }
    const trimmed = value.trim()
    if (!trimmed && required) this.warn(`必需字段「${key}」为空`)
    return trimmed || null
  }

  stringList(key: string, required = false): string[] {
    const value = this.raw(key, required)
    if (value === undefined || value === null) return []
    if (typeof value === 'string') {
      this.warn(`字段「${key}」应为数组，已按单项处理`)
      return value.trim() ? [value.trim()] : []
    }
    if (!Array.isArray(value)) {
      this.warn(`字段「${key}」应为数组，实际为 ${describeType(value)}`)
      return []
    }
    const items: string[] = []
    let nestedSeen = false
    for (const item of value) {
      if (typeof item === 'string') {
        if (item.trim()) items.push(item.trim())
      } else if (typeof item === 'number' || typeof item === 'boolean') {
        items.push(String(item))
      } else if (Array.isArray(item) && item.every((inner) => typeof inner === 'string')) {
        // YAML 把未加引号的 [[x]] 解析成嵌套数组，还原为 wikilink 文本
        nestedSeen = true
        items.push(`[[${item.join('|')}]]`)
      } else {
        this.warn(`字段「${key}」含无法识别的项（${describeType(item)}），已忽略`)
      }
    }
    if (nestedSeen) this.warn(`字段「${key}」含未加引号的 wikilink（被 YAML 解析为嵌套数组），已还原`)
    return items
  }

  boolean(key: string, required = false): boolean | null {
    const value = this.raw(key, required)
    if (value === undefined || value === null) return null
    if (typeof value === 'boolean') return value
    this.warn(`字段「${key}」应为布尔值，实际为 ${JSON.stringify(value)}`)
    return null
  }

  integer(key: string, required = false): number | null {
    const value = this.raw(key, required)
    if (value === undefined || value === null) return null
    if (typeof value === 'number' && Number.isInteger(value)) return value
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
    this.warn(`字段「${key}」应为整数，实际为 ${JSON.stringify(value)}`)
    return null
  }

  mapping(key: string, required = false): Record<string, unknown> | null {
    const value = this.raw(key, required)
    if (value === undefined || value === null) return null
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    this.warn(`字段「${key}」应为键值映射，实际为 ${describeType(value)}`)
    return null
  }
}

// ---------- 规范化函数（导出供单测） ----------

/** 出处 → bookId 数组（去重保序）；无法映射的片段单独返回 */
export function mapSourceBooks(sourceRaw: string | null): { bookIds: BookId[]; unmapped: string[] } {
  if (!sourceRaw) return { bookIds: [], unmapped: [] }
  const bookIds: BookId[] = []
  const unmapped: string[] = []
  for (const rawSegment of sourceRaw.split(SOURCE_SEGMENT_SEPARATOR)) {
    const segment = rawSegment.trim()
    if (!segment) continue
    const rule = SOURCE_BOOK_PREFIXES.find((candidate) => segment.startsWith(candidate.prefix))
    if (rule) bookIds.push(rule.bookId)
    else unmapped.push(segment)
  }
  return { bookIds: uniqueInOrder(bookIds), unmapped }
}

/** 证据定位 `路径:行号；路径:行号` → 结构化数组 */
export function splitEvidenceLocators(raw: string | null): KbEvidenceLocator[] {
  if (!raw) return []
  const locators: KbEvidenceLocator[] = []
  for (const rawPart of raw.split(EVIDENCE_LOCATOR_SEPARATOR)) {
    const part = rawPart.trim()
    if (!part) continue
    const match = /^(.*?):(\d+)$/.exec(part)
    locators.push(match ? { path: match[1].trim(), line: Number(match[2]) } : { path: part, line: null })
  }
  return locators
}

/** 术语列表规范化：按顿号拆分、去后缀、去重；全部为「待核」时返回 null */
export function normalizeTermList(
  items: string[],
  suffixToStrip?: string,
): { terms: string[] | null; splitApplied: boolean } {
  let splitApplied = false
  const terms: string[] = []
  for (const item of items) {
    const parts = item.split(TERM_SEPARATOR).map((part) => part.trim()).filter(Boolean)
    if (parts.length > 1) splitApplied = true
    for (const part of parts) {
      const stripped =
        suffixToStrip && part.length > suffixToStrip.length && part.endsWith(suffixToStrip)
          ? part.slice(0, -suffixToStrip.length)
          : part
      terms.push(stripped)
    }
  }
  const concrete = uniqueInOrder(terms.filter((term) => term !== PENDING_VALUE))
  if (concrete.length === 0 && terms.length > 0) return { terms: null, splitApplied }
  return { terms: concrete, splitApplied }
}

/** 原文编号 → 宋本条文号 / 宋本方号 */
export function parseFormulaSourceRefs(refs: string[]): {
  clauseNumbers: number[]
  songbenFormulaNumbers: number[]
} {
  const clauseNumbers: number[] = []
  const songbenFormulaNumbers: number[] = []
  for (const ref of refs) {
    const trimmed = ref.trim()
    if (SONGBEN_CLAUSE_REF_PATTERN.test(trimmed)) {
      clauseNumbers.push(Number(trimmed))
      continue
    }
    const formulaMatch = SONGBEN_FORMULA_REF_PATTERN.exec(trimmed)
    if (formulaMatch) songbenFormulaNumbers.push(Number(formulaMatch[1]))
  }
  return {
    clauseNumbers: uniqueInOrder(clauseNumbers).sort((a, b) => a - b),
    songbenFormulaNumbers: uniqueInOrder(songbenFormulaNumbers).sort((a, b) => a - b),
  }
}

/** 组成 / 汉代剂量 / 药物链接 按顺序对齐，并校验汉代剂量以药名开头 */
export function alignFormulaHerbs(
  compositionNames: string[],
  hanDoses: string[],
  herbLinks: string[],
): { herbs: KbFormulaHerb[]; messages: string[] } {
  const messages: string[] = []
  const names = compositionNames.map((name) => stripWikilinks(name).trim())
  if (hanDoses.length !== names.length) {
    messages.push(`组成 ${names.length} 味与汉代剂量 ${hanDoses.length} 项数量不一致，已按顺序对齐`)
  }
  const linksAligned = herbLinks.length === names.length
  if (herbLinks.length > 0 && !linksAligned) {
    messages.push(`组成 ${names.length} 味与药物链接 ${herbLinks.length} 项数量不一致，herbCard 未对齐`)
  }

  const herbs: KbFormulaHerb[] = []
  const missingPrefix: string[] = []
  const mismatched: string[] = []
  names.forEach((name, index) => {
    if (!name) {
      messages.push(`组成第 ${index + 1} 项为空`)
      return
    }
    const doseRaw = hanDoses[index]?.trim() || null
    let doseText = doseRaw
    if (doseRaw !== null) {
      if (doseRaw.startsWith(name)) {
        doseText = doseRaw.slice(name.length).trim() || null
      } else if (DOSE_QUANTITY_LEAD.test(doseRaw)) {
        missingPrefix.push(`${name}=${doseRaw}`)
      } else {
        mismatched.push(`${name}≠「${doseRaw}」`)
      }
    }
    let herbCard: string | null = null
    let herbLinkNote: string | null = null
    if (linksAligned) {
      const rawLink = herbLinks[index]
      const link = parseWikilink(rawLink)
      if (link) herbCard = wikilinkBasename(link.target)
      else herbLinkNote = rawLink.trim() || null
    }
    herbs.push({ name, doseRaw, doseText, herbCard, herbLinkNote })
  })

  if (missingPrefix.length > 0) {
    messages.push(
      `汉代剂量 ${missingPrefix.length}/${names.length} 项未带药名前缀（已按顺序对齐）：${missingPrefix.join('；')}`,
    )
  }
  if (mismatched.length > 0) {
    messages.push(`汉代剂量 ${mismatched.length} 项未以组成药名开头：${mismatched.join('；')}`)
  }
  if (hanDoses.length > names.length) {
    messages.push(`汉代剂量多出未对齐项：${hanDoses.slice(names.length).join('；')}`)
  }
  return { herbs, messages }
}

/** 条文号应唯一且覆盖 1..398 连续；返回违规描述 */
export function checkClauseSequence(numbers: number[]): string[] {
  const problems: string[] = []
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const value of numbers) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  if (duplicates.size > 0) {
    problems.push(`条文号重复：${[...duplicates].sort((a, b) => a - b).join('、')}`)
  }
  const missing: number[] = []
  for (let value = SONGBEN_CLAUSE_FIRST; value <= SONGBEN_CLAUSE_LAST; value += 1) {
    if (!seen.has(value)) missing.push(value)
  }
  if (missing.length > 0) problems.push(`条文号缺失：${missing.join('、')}`)
  const outOfRange = [...seen].filter((value) => !isSongbenClauseNumber(value)).sort((a, b) => a - b)
  if (outOfRange.length > 0) {
    problems.push(`条文号超出 ${SONGBEN_CLAUSE_FIRST}..${SONGBEN_CLAUSE_LAST}：${outOfRange.join('、')}`)
  }
  return problems
}

// ---------- 各类卡片转换 ----------

export function convertClauseCard(card: KbCard): ConvertResult<KbClause> {
  const reader = new CardFieldReader(card)
  const sections = splitSections(card.body)
  const declaredNumber = reader.integer('条文号', true)
  const fileNumber = clauseNumberFromLocator(card.locator)
  if (declaredNumber !== null && fileNumber !== null && declaredNumber !== fileNumber) {
    reader.warn(`条文号 ${declaredNumber} 与文件名编号 ${fileNumber} 不一致，以 frontmatter 为准`)
  }
  const number = declaredNumber ?? fileNumber
  if (number === null) {
    return { record: null, warnings: reader.warnings, skipReason: '缺少条文号且文件名无编号' }
  }
  if (declaredNumber === null) reader.warn(`条文号取自文件名：${number}`)
  if (!isSongbenClauseNumber(number)) {
    reader.warn(`条文号 ${number} 超出 ${SONGBEN_CLAUSE_FIRST}..${SONGBEN_CLAUSE_LAST}`)
  }

  const sixChannel = reader.string('六经', true)
  if (sixChannel !== null && !(SIX_CHANNEL_NAMES as readonly string[]).includes(sixChannel)) {
    reader.warn(`六经取值「${sixChannel}」不是六经病名（篇：${reader.string('篇') ?? '无'}）`)
  }

  const originalSection = findSectionByPrefix(sections, '原文')
  const quoteLines = originalSection === null ? [] : extractBlockquoteLines(originalSection)
  const text = stripWikilinks(quoteLines.filter((line) => line.trim()).join('\n')).trim() || null
  if (text === null) reader.warn('正文缺少「## 原文」引用块')

  return {
    record: {
      number,
      sixChannel,
      chapter: reader.string('篇', true),
      edition: reader.string('版本来源'),
      kangpingLayer: reader.string('康平层次'),
      versionDisputed: reader.boolean('版本争议'),
      formulaNames: uniqueInOrder(reader.stringList('关联方剂').map(linkTargetName).filter(Boolean)),
      symptomLabels: uniqueInOrder(reader.stringList('症状标签').map((label) => stripWikilinks(label).trim())),
      text,
      verifyStatus: reader.string('核验状态', true),
      locator: card.locator,
    },
    warnings: reader.warnings,
  }
}

function basenameWithoutExtension(locator: string): string {
  const segments = locator.split('/')
  return segments[segments.length - 1].replace(/\.md$/, '')
}

function requiredName(reader: CardFieldReader, card: KbCard, key: string): string {
  const declared = reader.string(key, true)
  const fileName = basenameWithoutExtension(card.locator)
  if (declared === null) {
    reader.warn(`「${key}」缺失，改用文件名「${fileName}」`)
    return fileName
  }
  const cleaned = stripWikilinks(declared).trim()
  if (cleaned !== fileName) reader.warn(`「${key}」为「${cleaned}」，与文件名「${fileName}」不一致`)
  return cleaned
}

export function convertFormulaCard(card: KbCard): ConvertResult<KbFormula> {
  const reader = new CardFieldReader(card)
  const sections = splitSections(card.body)
  const name = requiredName(reader, card, '方名')

  const sourceRaw = reader.string('出处', true)
  const { bookIds, unmapped } = mapSourceBooks(sourceRaw)
  if (unmapped.length > 0) reader.warn(`出处片段无法映射为 bookId：${unmapped.join('、')}`)

  const sourceRefsRaw = reader.stringList('原文编号')
  const parsedRefs = parseFormulaSourceRefs(sourceRefsRaw)
  const fromSongben = bookIds.includes('songben')
  if (!fromSongben && (parsedRefs.clauseNumbers.length > 0 || parsedRefs.songbenFormulaNumbers.length > 0)) {
    reader.warn(`出处「${sourceRaw ?? ''}」不含伤寒论，但原文编号含宋本条文号/方号，未解析`)
  }
  const clauseNumbers = fromSongben ? parsedRefs.clauseNumbers : []
  const outOfRange = clauseNumbers.filter((value) => !isSongbenClauseNumber(value))
  if (outOfRange.length > 0) reader.warn(`原文编号超出宋本条文范围：${outOfRange.join('、')}`)

  const composition = reader.stringList('组成', true)
  if (composition.length === 0) reader.warn('组成为空')
  const aligned = alignFormulaHerbs(composition, reader.stringList('汉代剂量'), reader.stringList('药物链接'))
  for (const message of aligned.messages) reader.warn(message)

  const frontmatterPreparation = reader.string('煎服法')
  const bodyPreparation = stripWikilinks(getSection(sections, '煎服法') ?? '').trim() || null
  let preparation = frontmatterPreparation
  let preparationBody: string | null = null
  if (frontmatterPreparation === null) {
    preparation = bodyPreparation
    if (bodyPreparation === null) reader.warn('frontmatter 与正文均无煎服法')
  } else if (bodyPreparation !== null && collapseWhitespace(bodyPreparation) !== collapseWhitespace(frontmatterPreparation)) {
    preparationBody = bodyPreparation
    reader.warn('frontmatter 煎服法与正文「## 煎服法」不一致，两者均保留')
  }

  return {
    record: {
      name,
      aliases: uniqueInOrder(reader.stringList('异名').map((alias) => stripWikilinks(alias).trim())),
      sourceRaw,
      sourceBooks: bookIds,
      sourceRefsRaw,
      clauseNumbers,
      songbenFormulaNumbers: fromSongben ? parsedRefs.songbenFormulaNumbers : [],
      dosageForm: pendingToNull(reader.string('剂型')),
      herbs: aligned.herbs,
      preparation,
      preparationBody,
      indications: reader.string('主治'),
      keySymptoms: reader.stringList('证候要点').map((item) => stripWikilinks(item).trim()),
      contraindications: reader.stringList('禁忌').map((item) => stripWikilinks(item).trim()),
      toxicHerbs: uniqueInOrder(reader.stringList('含毒药物').map(linkTargetName)),
      safetyLevel: reader.string('安全等级'),
      verifyStatus: reader.string('核验状态', true),
      evidenceLocators: splitEvidenceLocators(reader.string('证据定位')),
      relatedFormulas: uniqueInOrder(reader.stringList('相关方剂').map(linkTargetName)),
      hasConvertedDose: reader.stringList('折算剂量').length > 0,
      locator: card.locator,
    },
    warnings: reader.warnings,
  }
}

function readToxic(reader: CardFieldReader, card: KbCard): boolean | null {
  const value = card.data['含毒']
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === PENDING_VALUE) return null
  reader.warn(`含毒取值 ${JSON.stringify(value)} 无法识别，记为 null`)
  return null
}

export function convertHerbCard(card: KbCard): ConvertResult<KbHerb> {
  const reader = new CardFieldReader(card)
  const name = requiredName(reader, card, '药名')

  const natureFlavor = normalizeTermList(reader.stringList('性味'))
  if (natureFlavor.splitApplied) reader.warn('性味项内含分隔符，已拆分')
  const channels = normalizeTermList(reader.stringList('归经'), CHANNEL_SUFFIX)
  if (channels.splitApplied) reader.warn('归经项内含分隔符，已拆分并去「经」字')

  const sourceMapping = reader.mapping('数据来源')
  const sources: KbHerbSource[] = sourceMapping
    ? Object.entries(sourceMapping).map(([kind, value]) => ({
        kind,
        text: typeof value === 'string' ? value : JSON.stringify(value),
      }))
    : []

  return {
    record: {
      name,
      pharmacopoeiaName: pendingToNull(reader.string('药典名')),
      aliases: uniqueInOrder(reader.stringList('别名').map((alias) => stripWikilinks(alias).trim())),
      pinyin: pendingToNull(reader.string('拼音')),
      latin: pendingToNull(reader.string('拉丁名')),
      natureFlavor: natureFlavor.terms,
      channels: channels.terms,
      toxic: readToxic(reader, card),
      modernDose: pendingToNull(reader.string('现代常用量')),
      sources,
      verifyStatus: reader.string('核验状态', true),
      locator: card.locator,
    },
    warnings: reader.warnings,
  }
}

const TONGUE_PULSE_KEYS = { pulse: '脉', tongue: '舌' } as const

export function convertSyndromeCard(card: KbCard): ConvertResult<KbSyndrome> {
  const reader = new CardFieldReader(card)
  const sections = splitSections(card.body)
  const name = requiredName(reader, card, '证名')

  const clauseNumbers: number[] = []
  for (const rawLink of reader.stringList('关联条文', true)) {
    const value = clauseNumberFromLink(rawLink)
    if (value === null) reader.warn(`关联条文无法解析条文号：${rawLink}`)
    else clauseNumbers.push(value)
  }

  const tongueAndPulseRaw = reader.mapping('舌脉') ?? {}
  const knownKeys = Object.values(TONGUE_PULSE_KEYS) as string[]
  const unknownKeys = Object.keys(tongueAndPulseRaw).filter((key) => !knownKeys.includes(key))
  if (unknownKeys.length > 0) reader.warn(`舌脉含未识别键：${unknownKeys.join('、')}`)
  const readTongueOrPulse = (key: string): string | null => {
    const value = tongueAndPulseRaw[key]
    return typeof value === 'string' && value.trim() ? pendingToNull(value.trim()) : null
  }

  const differentialTargets = reader.stringList('鉴别证型').map(linkTargetName).filter(Boolean)
  const differentialNotes = reader.mapping('鉴别要点') ?? {}
  const noteFor = (target: string): string | null => {
    const value = differentialNotes[target]
    return typeof value === 'string' && value.trim() ? stripWikilinks(value).trim() : null
  }
  const differentials: KbSyndromeDifferential[] = uniqueInOrder(differentialTargets).map((target) => ({
    target,
    note: noteFor(target),
  }))
  const extraNoteKeys = Object.keys(differentialNotes).filter((key) => !differentialTargets.includes(key))
  for (const target of extraNoteKeys) differentials.push({ target, note: noteFor(target) })
  if (extraNoteKeys.length > 0) reader.warn(`鉴别要点含鉴别证型之外的条目：${extraNoteKeys.join('、')}`)

  const definition = stripWikilinks(getSection(sections, '定义') ?? '').trim() || null
  if (definition === null) reader.warn('正文缺少「## 定义」')

  return {
    record: {
      name,
      sixChannel: reader.string('六经', true),
      nature: reader.stringList('病性'),
      mainFormulas: uniqueInOrder(reader.stringList('主方', true).map(linkTargetName)),
      clauseNumbers: uniqueInOrder(clauseNumbers).sort((a, b) => a - b),
      mainSymptoms: reader.stringList('主症').map((item) => stripWikilinks(item).trim()),
      tongueAndPulse: {
        pulse: readTongueOrPulse(TONGUE_PULSE_KEYS.pulse),
        tongue: readTongueOrPulse(TONGUE_PULSE_KEYS.tongue),
      },
      differentials,
      definition,
      locator: card.locator,
    },
    warnings: reader.warnings,
  }
}

export function convertCommentaryCard(card: KbCard): ConvertResult<KbCommentary> {
  const reader = new CardFieldReader(card)
  const sections = splitSections(card.body)

  const linkedNumbers = uniqueInOrder(
    reader
      .stringList('关联条文', true)
      .map(clauseNumberFromLink)
      .filter((value): value is number => value !== null),
  )
  if (linkedNumbers.length > 1) reader.warn(`关联条文有 ${linkedNumbers.length} 条，取第一条`)
  const fileNumber = clauseNumberFromLocator(card.locator)
  const clauseNumber = linkedNumbers[0] ?? fileNumber
  if (clauseNumber === null || clauseNumber === undefined) {
    return { record: null, warnings: reader.warnings, skipReason: '无法确定关联条文号' }
  }
  if (linkedNumbers.length === 0) reader.warn(`关联条文缺失，条文号取自文件名：${clauseNumber}`)
  if (fileNumber !== null && fileNumber !== clauseNumber) {
    reader.warn(`关联条文 ${clauseNumber} 与文件名编号 ${fileNumber} 不一致`)
  }
  if (!isSongbenClauseNumber(clauseNumber)) reader.warn(`关联条文号 ${clauseNumber} 超出宋本范围`)

  const evidenceSection = getSection(sections, '原文依据')
  if (evidenceSection === null) reader.warn('正文缺少「## 原文依据」')
  const summarySection = getSection(sections, '解读提要')
  if (summarySection === null) reader.warn('正文缺少「## 解读提要」')
  const summary =
    summarySection === null
      ? null
      : extractListItems(summarySection)
          .map((item) => stripWikilinks(item).trim())
          .filter(Boolean)
          .join('\n') || null

  return {
    record: {
      commentator: reader.string('解读家', true),
      sourceBook: reader.string('来源', true),
      clauseNumber,
      formulaNames: uniqueInOrder(reader.stringList('关联方剂').map(linkTargetName).filter(Boolean)),
      quotes: evidenceSection === null ? [] : extractBacktickSpans(evidenceSection),
      summary,
      status: reader.string('状态'),
      licenseRestricted: true,
      locator: card.locator,
    },
    warnings: reader.warnings,
  }
}

// ---------- 汇总 ----------

function sortByName<T extends { name: string; locator: string }>(records: T[]): T[] {
  return records.sort((a, b) => compareZh(a.name, b.name) || compareZh(a.locator, b.locator))
}

function reportDuplicates(keys: Array<{ key: string; locator: string }>, label: string, sectionDir: string): KbWarning[] {
  const byKey = new Map<string, string[]>()
  for (const { key, locator } of keys) byKey.set(key, [...(byKey.get(key) ?? []), locator])
  return [...byKey.entries()]
    .filter(([, locators]) => locators.length > 1)
    .map(([key, locators]) => ({ path: sectionDir, message: `${label}「${key}」重复：${locators.join('、')}` }))
}

/** 原始文件 → 数据集；单卡失败只记入 skipped，不中断 */
export function buildKbDataset(files: KbRawFile[]): KbDataset {
  const dataset: KbDataset = {
    clauses: [],
    formulas: [],
    herbs: [],
    syndromes: [],
    commentaries: [],
    skipped: [],
    warnings: [],
  }
  const orderedFiles = [...files].sort((a, b) => (a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0))

  for (const file of orderedFiles) {
    const parsed = parseMarkdownWithFrontmatter(file.text)
    if (!parsed.ok) {
      dataset.skipped.push({ path: file.locator, reason: parsed.message })
      continue
    }
    const expectedType = KB_SECTIONS[file.section].cardType
    if (parsed.data.type !== expectedType) {
      dataset.skipped.push({
        path: file.locator,
        reason: `type 为 ${JSON.stringify(parsed.data.type ?? null)}，期望「${expectedType}」`,
      })
      continue
    }
    const card: KbCard = { locator: file.locator, data: parsed.data, body: parsed.body }
    try {
      switch (file.section) {
        case 'clauses':
          collect(dataset, dataset.clauses, convertClauseCard(card), file.locator)
          break
        case 'formulas':
          collect(dataset, dataset.formulas, convertFormulaCard(card), file.locator)
          break
        case 'herbs':
          collect(dataset, dataset.herbs, convertHerbCard(card), file.locator)
          break
        case 'syndromes':
          collect(dataset, dataset.syndromes, convertSyndromeCard(card), file.locator)
          break
        case 'commentaries':
          collect(dataset, dataset.commentaries, convertCommentaryCard(card), file.locator)
          break
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      dataset.skipped.push({ path: file.locator, reason: `转换异常：${message}` })
    }
  }

  dataset.clauses.sort((a, b) => a.number - b.number || compareZh(a.locator, b.locator))
  sortByName(dataset.formulas)
  sortByName(dataset.herbs)
  sortByName(dataset.syndromes)
  dataset.commentaries.sort(
    (a, b) =>
      a.clauseNumber - b.clauseNumber ||
      compareZh(a.commentator ?? '', b.commentator ?? '') ||
      compareZh(a.locator, b.locator),
  )

  if (files.some((file) => file.section === 'clauses')) {
    for (const problem of checkClauseSequence(dataset.clauses.map((clause) => clause.number))) {
      dataset.warnings.push({ path: KB_SECTIONS.clauses.dir, message: problem })
    }
  }
  dataset.warnings.push(
    ...reportDuplicates(
      dataset.formulas.map((formula) => ({ key: formula.name, locator: formula.locator })),
      '方名',
      KB_SECTIONS.formulas.dir,
    ),
    ...reportDuplicates(
      dataset.herbs.map((herb) => ({ key: herb.name, locator: herb.locator })),
      '药名',
      KB_SECTIONS.herbs.dir,
    ),
    ...reportDuplicates(
      dataset.syndromes.map((syndrome) => ({ key: syndrome.name, locator: syndrome.locator })),
      '证名',
      KB_SECTIONS.syndromes.dir,
    ),
    ...reportDuplicates(
      dataset.commentaries.map((commentary) => ({
        key: `${commentary.commentator ?? '?'}#${commentary.clauseNumber}`,
        locator: commentary.locator,
      })),
      '注家+条文',
      KB_SECTIONS.commentaries.dir,
    ),
  )
  dataset.skipped.sort((a, b) => compareZh(a.path, b.path))
  return dataset
}

function collect<T>(dataset: KbDataset, target: T[], result: ConvertResult<T>, locator: string): void {
  dataset.warnings.push(...result.warnings)
  if (result.record) target.push(result.record)
  else dataset.skipped.push({ path: locator, reason: result.skipReason ?? '转换失败' })
}

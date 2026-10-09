import assert from 'node:assert/strict'
import type { FormulaHerb, Modification } from '../../src/types/data.ts'
import { CJK, DOSE_BODY, DOSE_UNITS } from './cjk.ts'
import {
  extractDoseRaw,
  injectDoseIntoToken,
  parseDose,
  tokenHasExplicitDose,
} from './dose.ts'
import { resolveKnownHerbName } from './herb-lexicon.ts'
import {
  extractProcessing,
  isPrepOrMetaToken,
  isProcessingOnlyToken,
  isSpuriousHerbName,
  parseHerbToken,
  type NormalizedHerb,
} from './herbs.ts'
import { toSimplifiedChinese } from './wiki.ts'

/** 方名须含扩展 A 区汉字（大黄䗪虫丸）；「饮子」须先于「饮」匹配 */
const FORMULA_NAME_RE = new RegExp(
  `^['"*:：\\s《]*([${CJK}]{2,24}?(?:汤|散|丸|膏|煎|饮子|饮|醴|酒))方?\\*?['"*\\s》]*[：:]*$`,
)
/** 「…方」小标题里，汤散丸等之外可作方名结尾的字：猪胆汁方、蜜煎导方、土瓜根方 */
export const FANG_HEADING_NAME_ENDINGS = ['汁', '导', '煎', '根'] as const
/** 方名起首为这些动词 / 介词时多是叙述残句（「宜蜜煎导方」「取汁方」），不当小标题 */
const FANG_HEADING_FORBIDDEN_LEADS = '宜与以用治疗主取服作若可当和加'
/** 「…方」小标题方名最长字数（不含「方」字） */
const FANG_HEADING_MAX_NAME_LENGTH = 8
/** 小标题校注最长字数：「附方」「附方佚」 */
const FANG_HEADING_MAX_ANNOTATION_LENGTH = 6
/**
 * 「…方」小标题：「方」字必须出现，可带「（附方）」类校注；整行不含标点，叙述句不会命中。
 * 与 FORMULA_NAME_RE 不同，这里的「方」不可省，否则「猪胆汁」「葛根」等药名行会被当成方名。
 */
const FANG_HEADING_RE = new RegExp(
  `^['"*:：\\s《]*([${CJK}]{1,${FANG_HEADING_MAX_NAME_LENGTH - 1}}(?:${FANG_HEADING_NAME_ENDINGS.join('|')}))方` +
    `(?:[（(]([^（）()]{1,${FANG_HEADING_MAX_ANNOTATION_LENGTH}})[）)])?['"*\\s》]*[：:]*$`,
)
/** 校注注明原方已佚：只建模方名，herbs 留空，不补造组成 */
const LOST_FORMULA_ANNOTATION_RE = /佚/

const PREP_START_RE = /^(?:上|右)([一二三四五六七八九十百]+|[0-9]+)味/
/** 「上一味」「右一味」：煎服法声明本方只有一味药 */
const SINGLE_HERB_PREP_RE = /^(?:上|右)一味/
/** 单味描述行里从行首取已知药名的长度范围 */
const MIN_DESCRIBED_HERB_NAME_LENGTH = 2
const MAX_DESCRIBED_HERB_NAME_LENGTH = 8

/** 单行「药+制法」中开始制法的动作词：和少许法醋、以灌谷道内、内谷道中 */
const INLINE_PREP_LEAD_RE = /^(?:和|以|内|纳|灌|煎|煮|服|捣|研|烧|渍|绞|合|取|为)/
/** 夹在药味与制法之间、并回该味的短炮制语最长字数（「泻汁」） */
const INLINE_PROCESSING_MAX_LENGTH = 4

/** 方名后的主治说明：「治脚气疼痛，不可屈伸。」「除热瘫痫。」「退五脏虚热」——不是药味行 */
const INDICATION_LINE_RE = new RegExp(
  `^(?:(?:治|主治|兼治|除|疗)[^一二三四五六七八九十百半两\\d]|退(?![一二三四五六七八九十百半两\\d]+(?:${DOSE_UNITS})))`,
)

/** 可单独成片、应并回上一味的炮制词（「熬焦」「去皮心熬」「炙香」） */
const ORPHAN_PROCESSING_WORDS =
  '去皮尖|去皮子|去皮|去心|去节|去尖|去芦|去目|去毛|去核|去子|尖|心|炮|炙|熬|焦|香|洗|擘|劈|切|破|碎|炒|研|生用|汤泡|酒洗|蜜炙|出汗|绵裹|为膏|为末|令黄|如脂'
const ORPHAN_PROCESSING_RE = new RegExp(
  `^(?:${ORPHAN_PROCESSING_WORDS})+(?:[（(][^）)]*[）)])?[。.]?$`,
)

/** 上锉 / 右二味 / 以上三味 / 上先以水洗… 等煎服法起句 */
const PREP_INSTRUCTION_RE =
  /^(?:以上|上|右)(?:[一二三四五六七八九十百]+味|锉|先|以|为|杵|捣|筛|每|洗)|^(?:以上|上|右).{0,8}(?:锉|煮取|煎取|以水|先以|为细末|杵为|捣筛|咬咀|㕮咀)/

/** 以数字 / 「半」起首的已知药名（半夏、五味子、三七、百合）在行首取名的长度范围 */
const MIN_NUMERAL_LED_HERB_NAME_LENGTH = 2
const MAX_NUMERAL_LED_HERB_NAME_LENGTH = 4
const NUMERAL_LEAD_RE = /^[一二三四五六七八九十百半两\d]/

/** 「细辛　三两」里与药名隔开的纯剂量片段（可带炮制注）；须以数字起首，「等分」「少许」另有回填规则 */
const DETACHED_DOSE_RE = new RegExp(`^(?=[一二三四五六七八九十百半两\\d])${DOSE_BODY}(?:[（(][^（）()]*[）)])?$`)

/** 「泽泻阿胶」：原文漏刻分隔、粘成一串的已知药名，每段长度范围与整串最长字数 */
const MIN_GLUED_HERB_NAME_LENGTH = 2
const MAX_GLUED_HERB_NAME_LENGTH = 6
const MAX_GLUED_HERB_TOKEN_LENGTH = 12

/** 煎服法里「各」量的是溶剂而非药味：水 / 浆水 / 潦水 / 甘澜水、酒 / 清酒 / 苦酒、蜜、醋（水蛭、水银是药名） */
const SOLVENT_CLAUSE_RE = /水(?![蛭银])|酒|浆|蜜|醋/
/** 判断「各」「等分」归属时，只看同一分句 */
const PREP_CLAUSE_BOUNDARY_RE = /[，,。；;：:（()）]/
/** 「上四味，等分」「右三味，杵为散，等分」：味数之后不远处的等分 */
const STATED_COUNT_BEFORE_EQUAL_FEN_RE = /(?:上|右)[一二三四五六七八九十百]+味[^。]{0,12}$/
const SHARED_DOSE_AFTER_GE_RE = new RegExp(`各(十分|[一二三四五六七八九十百半两\\d.]+(?:${DOSE_UNITS})?)`, 'g')

/** 下一条文起句（勿含百合/奔豚等可作药名或方名开头的词） */
const CLAUSE_START_RE =
  /^(?:伤寒|太阳|阳明|少阳|太阴|少阴|厥阴|问曰|师曰|凡用|病者|妇人中风|妇人妊娠|妇人产后|发汗后|下之后)/

/** 维基宋本常见讹字 / 省文，在切分前归一 */
function normalizeHerbLineSource(line: string): string {
  return line
    .replace(/两檗/g, '黄檗')
    .replace(/兩檗/g, '黄檗')
    .replace(/株茯苓/g, '茯苓')
    .replace(/黄芩三两了/g, '黄芩三两')
    .replace(/黄芩三兩了/g, '黄芩三两')
    // 金匮「桂枝附子（炮）各一两」粘连
    .replace(
      /桂枝附子（炮）各([一二三四五六七八九十百两钱分升合]+)/g,
      '桂枝$1 附子（炮）$1',
    )
    .replace(
      /桂枝附子各([一二三四五六七八九十百两钱分升合]+)/g,
      '桂枝$1 附子$1',
    )
    // 「桃仁去皮、尖，熬」→ 炮制内顿号改为逗号，避免切成独立药味
    .replace(/去皮、尖/g, '去皮尖')
    .replace(/去皮、尖、/g, '去皮尖、')
    // 「枳实三枚大者」「附子大者一枚」
    .replace(/枚大者/g, '枚（大者）')
    .replace(/枚小者/g, '枚（小者）')
    .replace(/大者(?=[一二三四五六七八九十百])/g, '（大者）')
    .replace(/小者(?=[一二三四五六七八九十百])/g, '（小者）')
    // 「鳖甲手指大一片（炙）」：形容大小的词移入注文，剂量紧随药名
    .replace(
      /(如?手指大)([一二三四五六七八九十百半]+(?:片|枚|个))(?:（([^）]*)）)?/g,
      (_match, size: string, dose: string, extra?: string) =>
        extra ? `${dose}（${size}，${extra}）` : `${dose}（${size}）`,
    )
    // 金匮「桑东南根自皮」「瓜办」：「白」讹作「自」、「瓣」讹作「办」
    .replace(/根自皮/g, '根白皮')
    .replace(/瓜办/g, '瓜瓣')
}

/**
 * 补全缺失的左括号：「川乌五枚㕮咀，以蜜二升，煎取一升，即出乌头）」
 * → 在该味剂量之后补「（」，避免括号内的煎法被逗号切成药味。
 */
export function repairUnopenedParen(line: string): string {
  let depth = 0
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '（' || char === '(') {
      depth += 1
      continue
    }
    if (char !== '）' && char !== ')') continue
    if (depth > 0) {
      depth -= 1
      continue
    }
    const segmentStart = line.lastIndexOf(' ', index) + 1
    const segment = line.slice(segmentStart, index)
    const doseMatch = segment.match(new RegExp(`^[${CJK}]{1,8}?${DOSE_BODY}`))
    if (!doseMatch) return line
    const insertAt = segmentStart + doseMatch[0].length
    return repairUnopenedParen(`${line.slice(0, insertAt)}（${line.slice(insertAt)}`)
  }
  return line
}

/** 不在括号内按空白 / 顿号切分 */
export function splitHerbLine(line: string): string[] {
  const cleaned = repairUnopenedParen(
    normalizeHerbLineSource(line)
      .replace(/　/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  if (!cleaned) return []

  const tokens: string[] = []
  let current = ''
  let depth = 0

  const flush = () => {
    const token = current.trim()
    current = ''
    if (!token) return
    // 仅拆「白术甘草各二两」这类连写多名；单名「白术各三两」留给各剂量回填
    const eachMatch = token.match(new RegExp(`^([${CJK}]{4,12})各(.+)$`))
    if (eachMatch) {
      const names = eachMatch[1]!
      const dose = eachMatch[2]!
      const nameTokens = names.match(new RegExp(`[${CJK}]{2,3}`, 'g')) ?? []
      if (nameTokens.length >= 2 && nameTokens.join('') === names) {
        for (const name of nameTokens) tokens.push(`${name}${dose}`)
        return
      }
    }
    for (const part of splitGluedHerbToken(token)) tokens.push(...splitGluedKnownHerbNames(part))
  }

  for (const char of cleaned) {
    if (char === '（' || char === '(') {
      depth += 1
      current += char
      continue
    }
    if (char === '）' || char === ')') {
      depth = Math.max(0, depth - 1)
      current += char
      continue
    }
    if (
      depth === 0 &&
      (char === ' ' || char === '、' || char === '；' || char === ';' || char === '，' || char === ',')
    ) {
      flush()
      continue
    }
    current += char
  }
  flush()
  // 「干姜两半，人参一两」切开后，把「一法二分」类校注并回上一味
  const normalized: string[] = []
  for (const token of tokens) {
    if (/^一法/.test(token) && normalized.length > 0) {
      normalized[normalized.length - 1] = `${normalized[normalized.length - 1]}（${token}）`
      continue
    }
    // 采收时令 / 孤立「汁」并入上一味
    if (
      normalized.length > 0 &&
      /(?:采|採|除日|闭口|阴干|^汁$)/.test(token) &&
      !tokenHasExplicitDose(token)
    ) {
      normalized[normalized.length - 1] = appendProcessingFragment(
        normalized[normalized.length - 1]!,
        token,
      )
      continue
    }
    normalized.push(token)
  }
  return normalized
}

/** 只认原文写法（不走别名模糊匹配），避免把「一两黄耆」之类剂量续写当成药名 */
function isExactKnownHerbName(candidate: string): boolean {
  return resolveKnownHerbName(candidate) === candidate
}

/** 「（切）半夏半升」：数字起首，但行首是已知药名而非剂量续写 */
function startsWithNumeralLedHerbName(text: string): boolean {
  const maxLength = Math.min(MAX_NUMERAL_LED_HERB_NAME_LENGTH, text.length)
  for (let length = maxLength; length >= MIN_NUMERAL_LED_HERB_NAME_LENGTH; length -= 1) {
    if (isExactKnownHerbName(text.slice(0, length))) return true
  }
  return false
}

function looksLikeNextHerbName(text: string): boolean {
  if (!new RegExp(`^[${CJK}]{2,}`).test(text)) return false
  if (text.startsWith('各')) return false
  // 剂量续写：一两十六铢、二两半……；半夏、五味子等药名除外
  if (NUMERAL_LEAD_RE.test(text) && !startsWithNumeralLedHerbName(text)) return false
  if (/^(等分|如|一法)/.test(text)) return false
  // 煎服法尾巴
  if (/^(为膏|为末|为散|杵|捣|筛|右|上|煮|煎|服|去滓)/.test(text)) return false
  return true
}

/** 「升麻」：末字「升」是药名而非升量单位 */
function endsWithHerbNameUnit(current: string, rest: string): boolean {
  if (current.endsWith('升') && rest.startsWith('麻')) return true
  return false
}

/**
 * 拆开无空格粘连的药味，如「大枣四枚（擘）杏仁二十四枚（汤浸…）」
 */
export function splitGluedHerbToken(token: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  const unitTail = new RegExp(`(?:${DOSE_UNITS})$`)
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]!
    if (char === '（' || char === '(') depth += 1
    if (char === '）' || char === ')') {
      depth = Math.max(0, depth - 1)
      current += char
      const rest = token.slice(index + 1)
      if (
        depth === 0 &&
        tokenHasExplicitDose(current) &&
        looksLikeNextHerbName(rest) &&
        !endsWithHerbNameUnit(current, rest)
      ) {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += char
    // 「十二枚杏仁」：剂量单位后直接接下味药名
    // 须已具备完整剂量，避免把「升麻」的「升」、「两檗」的「两」当成单位切开
    if (
      depth === 0 &&
      unitTail.test(current) &&
      tokenHasExplicitDose(current) &&
      index + 1 < token.length
    ) {
      const rest = token.slice(index + 1)
      if (looksLikeNextHerbName(rest) && !endsWithHerbNameUnit(current, rest)) {
        parts.push(current)
        current = ''
      }
    }
  }
  if (current) parts.push(current)
  return parts.length > 0 ? parts : [token]
}

/**
 * 整串切成若干原文写法的已知药名；切不尽返回 null。
 * 每步只取最长匹配、不回溯：回溯会把「山茱萸肉」切成别名「山茱」+「萸肉」。
 */
function segmentExactKnownHerbNames(text: string): string[] | null {
  const segments: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    const maxLength = Math.min(MAX_GLUED_HERB_NAME_LENGTH, text.length - cursor)
    let matchedLength = 0
    for (let length = maxLength; length >= MIN_GLUED_HERB_NAME_LENGTH; length -= 1) {
      if (isExactKnownHerbName(text.slice(cursor, cursor + length))) {
        matchedLength = length
        break
      }
    }
    if (matchedLength === 0) return null
    segments.push(text.slice(cursor, cursor + matchedLength))
    cursor += matchedLength
  }
  return segments
}

/**
 * 宋本猪苓汤「泽泻阿胶　滑石（碎）各一两」：原文漏刻分隔，两味药粘成一串。
 * 仅拆无剂量、本身不可解析、且能完整切成两味以上已知药名的片段；括号注归最后一味。
 */
export function splitGluedKnownHerbNames(token: string): string[] {
  if (tokenHasExplicitDose(token)) return [token]
  const match = token.match(new RegExp(`^([${CJK}]+)((?:[（(].*)?)$`))
  if (!match) return [token]
  const names = match[1]!
  const note = match[2] ?? ''
  if (names.length < MIN_GLUED_HERB_NAME_LENGTH * 2 || names.length > MAX_GLUED_HERB_TOKEN_LENGTH) {
    return [token]
  }
  if (resolveKnownHerbName(names)) return [token]
  const segments = segmentExactKnownHerbNames(names)
  if (!segments || segments.length < 2) return [token]
  assert.equal(segments.join(''), names, `splitGluedKnownHerbNames 切分须覆盖原串：${names}`)
  segments[segments.length - 1] = `${segments[segments.length - 1]}${note}`
  return segments
}

function isDetachedDoseToken(token: string): boolean {
  if (!DETACHED_DOSE_RE.test(token)) return false
  // 「百合」字面上也是「百 + 合」
  return !isExactKnownHerbName(token.replace(PAREN_NOTE_RE, ''))
}

/**
 * 「细辛　三两」「人参 二钱」：药名与剂量之间有空格，切开后剂量成了孤立片段。
 * 把纯剂量片段并回紧邻的、尚无剂量的上一味；上一味已有剂量或不是药名时保持原样。
 */
export function mergeDetachedDoses(tokens: string[]): string[] {
  const merged: string[] = []
  for (const token of tokens) {
    const previous = merged[merged.length - 1]
    if (
      previous !== undefined &&
      isDetachedDoseToken(token) &&
      !tokenHasExplicitDose(previous) &&
      !isDetachedDoseToken(previous) &&
      !previous.includes('各') &&
      new RegExp(`^[${CJK}]`).test(previous) &&
      parseHerbToken(previous) !== null
    ) {
      const noteMatch = token.match(/[（(]([^（）()]*)[）)]$/)
      const dose = noteMatch ? token.slice(0, noteMatch.index) : token
      // 剂量插在药名（首个括号之前）末尾；不用 injectDoseIntoToken，药名含扩展 B 区以后的字时它会从中间插入
      const nameEnd = previous.search(/[（(]/)
      const nameLength = nameEnd < 0 ? previous.length : nameEnd
      const withDose = `${previous.slice(0, nameLength)}${dose}${previous.slice(nameLength)}`
      merged[merged.length - 1] = noteMatch?.[1]
        ? appendProcessingFragment(withDose, noteMatch[1])
        : withDose
      continue
    }
    merged.push(token)
  }
  return merged
}

/** 把因历史错误切出的炮制残片并回上一味药 */
export function appendProcessingFragment(previous: string, fragment: string): string {
  const frag = fragment.trim()
  if (!frag) return previous

  if (/[（(]/.test(previous) && !/[）)]/.test(previous)) {
    if (frag.startsWith('）') || frag.startsWith(')')) {
      return `${previous}${frag.replace(/^\)/, '）')}`
    }
    const closed = frag.includes('）') || frag.includes(')')
    return `${previous} ${frag}${closed ? '' : '）'}`
  }

  const processing = frag.replace(/[（）()]/g, '').trim()
  if (!processing) return previous
  if (/[（(].+[）)]$/.test(previous)) {
    return previous.replace(/[）)]$/, `，${processing}）`)
  }
  return `${previous}（${processing}）`
}

function isOrphanProcessingFragment(token: string): boolean {
  const simplified = toSimplifiedChinese(token).trim()
  if (isProcessingOnlyToken(simplified)) return true
  if (/^[）)]/.test(simplified)) return true
  // 仅「炙」「炮去皮」「熬焦」等纯炮制碎片；「炙甘草（二钱）」是完整药味，勿并入上一味
  return ORPHAN_PROCESSING_RE.test(simplified)
}

export function mergeProcessingOrphans(tokens: string[]): string[] {
  const merged: string[] = []
  for (const token of tokens) {
    if (isOrphanProcessingFragment(token) && merged.length > 0) {
      merged[merged.length - 1] = appendProcessingFragment(merged[merged.length - 1]!, token)
      continue
    }
    merged.push(token)
  }
  return merged
}

/**
 * 处理「芍药　生姜（切）　甘草（炙）　麻黄（去节）各一两」：
 * 将「各X」剂量回填到前方连续无剂量药味。
 */
export function applyGeDosePropagation(tokens: string[]): string[] {
  const result = [...tokens]
  for (let index = 0; index < result.length; index += 1) {
    const token = result[index]!
    if (!token.includes('各')) continue
    const geIndex = token.indexOf('各')
    const herbPart = token.slice(0, geIndex).trim()
    const after = token.slice(geIndex + 1).trim()
    const doseMatch = after.match(
      new RegExp(
        `^(等分|如鸡子大|如弹丸大|如弹子大|少许|[一二三四五六七八九十百半两\\d.]+(?:${DOSE_UNITS})?(?:[一二三四五六七八九十百半两\\d.]+(?:${DOSE_UNITS})?)*)`,
      ),
    )
    if (!doseMatch) continue
    const sharedDose = doseMatch[1]!
    const trailing = after.slice(sharedDose.length)

    if (herbPart) {
      result[index] = `${injectDoseIntoToken(herbPart, sharedDose)}${trailing}`
    } else {
      // 独立「各等分」标记：删掉本 token，只回填前方
      result[index] = ''
    }

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = result[cursor]!
      if (!previous) continue
      if (tokenHasExplicitDose(previous)) break
      result[cursor] = injectDoseIntoToken(previous, sharedDose)
    }
  }
  return result.filter(Boolean)
}

/** 「栝蒌根　牡蛎熬等分」：无「各」的尾随等分回填 */
export function applyTrailingEqualFen(tokens: string[]): string[] {
  const result = [...tokens]
  for (let index = 0; index < result.length; index += 1) {
    const token = result[index]!
    if (!/等分/.test(token) || token.includes('各')) continue
    // 保证本味带「等分」剂量形态，便于后续 extractDoseRaw
    if (!tokenHasExplicitDose(token)) {
      const nameOnly = token.replace(/等分/g, '').trim()
      result[index] = `${nameOnly}等分`
    }
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = result[cursor]!
      if (tokenHasExplicitDose(previous)) break
      result[cursor] = injectDoseIntoToken(previous, '等分')
    }
  }
  return result
}

const PAREN_NOTE_RE = /[（(][^（）()]*[）)]/g

/** 括号内注文（「㕮咀，以蜜二升，煎取一升」）含煎法词时，不应让整味被判成煎服法 */
function isPrepOrMetaIgnoringNote(token: string): boolean {
  const head = token.replace(PAREN_NOTE_RE, '').trim()
  return isPrepOrMetaToken(head || token)
}

/** parseHerbToken 因注文含煎法词而返回 null 时，改从括号前的「药名+剂量」解析 */
function parseHerbTokenIgnoringNote(token: string): { herb: NormalizedHerb; head: string } | null {
  const match = token.match(/^([^（(]+)[（(](.*)[）)]$/)
  if (!match) return null
  const head = match[1]!.trim()
  const note = match[2]!.trim()
  const parsed = parseHerbToken(head)
  if (!parsed) return null
  return {
    head,
    herb: {
      ...parsed,
      note: note || parsed.note,
      processing: parsed.processing ?? extractProcessing(note),
    },
  }
}

/** 「獭肝一具」：剂量单位未收录时数量词粘在药名后 */
const TRAILING_COUNT_RE = /^(.+?)([一二三四五六七八九十百半两\d]+(?:具|只|头|条|握|撮|挺|段|节))$/
/** 「附子炮」「钟乳研炼」：药名与剂量之间夹炮制词 */
const TRAILING_PROCESSING_RE = new RegExp(`^(.+?)((?:${ORPHAN_PROCESSING_WORDS}|炼)+)$`)

/**
 * 药名无法解析时，剥掉粘连的数量词 / 炮制词再试一次；仍不可解析返回 null。
 * 只做「剥尾巴」，不猜测别名。
 */
export function recoverKnownHerb(herb: FormulaHerb): FormulaHerb | null {
  const countMatch = herb.name.match(TRAILING_COUNT_RE)
  if (countMatch) {
    const resolved = resolveKnownHerbName(countMatch[1]!)
    if (resolved) {
      return {
        ...herb,
        herbId: resolved.normalize('NFKC'),
        name: resolved,
        doseRaw: herb.doseRaw || countMatch[2]!,
      }
    }
  }
  const processingMatch = herb.name.match(TRAILING_PROCESSING_RE)
  if (processingMatch) {
    const resolved = resolveKnownHerbName(processingMatch[1]!)
    if (resolved) {
      const labels = [herb.processing, processingMatch[2]].filter(Boolean).join('、')
      return {
        ...herb,
        herbId: resolved.normalize('NFKC'),
        name: resolved,
        processing: [...new Set(labels.split('、'))].join('、'),
      }
    }
  }
  return null
}

export function parseHerbLine(line: string): FormulaHerb[] {
  const tokens = applyTrailingEqualFen(
    applyGeDosePropagation(
      mergeDetachedDoses(mergeProcessingOrphans(splitHerbLine(toSimplifiedChinese(line)))),
    ),
  )
  const herbs: FormulaHerb[] = []

  for (const token of tokens) {
    const isMeta = isPrepOrMetaIgnoringNote(token)
    if (isMeta || isProcessingOnlyToken(token) || isOrphanProcessingFragment(token)) {
      if (herbs.length === 0) continue
      if (isMeta && !isOrphanProcessingFragment(token) && !isProcessingOnlyToken(token)) {
        continue
      }
      const previous = herbs[herbs.length - 1]!
      const processing = extractProcessing(token)
      if (processing) {
        previous.processing = previous.processing
          ? [...new Set([...previous.processing.split('、'), ...processing.split('、')])].join('、')
          : processing
      }
      previous.rawText = appendProcessingFragment(previous.rawText, token)
      continue
    }

    const direct = parseHerbToken(token)
    const fromHead = direct ? null : parseHerbTokenIgnoringNote(token)
    const normalized = direct ?? fromHead?.herb
    if (!normalized) continue
    if (isProcessingOnlyToken(normalized.name) || isSpuriousHerbName(normalized.name)) {
      if (herbs.length === 0) continue
      const previous = herbs[herbs.length - 1]!
      const processing = extractProcessing(token) ?? normalized.name
      previous.processing = previous.processing
        ? [...new Set([...previous.processing.split('、'), ...processing.split('、')])].join('、')
        : processing
      previous.rawText = appendProcessingFragment(previous.rawText, token)
      continue
    }

    // 注文里的「以蜜二升」不是本味剂量：走注文剥离路径时只从括号前取剂量
    const doseSource = fromHead ? fromHead.head : token
    const dose = parseDose(doseSource)
    const doseRaw = extractDoseRaw(doseSource) || dose.doseRaw
    herbs.push({
      herbId: normalized.herbId,
      name: normalized.name,
      rawText: token,
      doseRaw,
      doseLiang: dose.doseLiang,
      doseSheng: dose.doseSheng,
      doseCount: dose.doseCount,
      processing: normalized.processing,
      note: normalized.note,
    })
  }
  return herbs
}

export function parseModifications(text: string): Modification[] {
  const simplified = toSimplifiedChinese(text)
  const mods: Modification[] = []
  const re =
    /若([^，。；]{1,30}?)[，,]?(?:去([^，。；加]*?))?(?:[，,]?加([^。；]+))?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(simplified)) !== null) {
    const condition = match[1]?.trim() ?? ''
    const removeRaw = match[2]?.trim() ?? ''
    const addRaw = match[3]?.trim() ?? ''
    if (!condition || (!removeRaw && !addRaw)) continue
    if (!/渴|烦|呕|痛|悸|咳|利|热|寒|满|硬|不利|汗|厥/.test(condition) && condition.length > 20) {
      continue
    }
    const remove = removeRaw
      ? removeRaw
          .split(/[、与及和]/g)
          .map((item) => parseHerbToken(item)?.name)
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.length > 0 && !isProcessingOnlyToken(item),
          )
      : []
    const add = addRaw
      ? parseHerbLine(addRaw).map((herb) => ({
          herbId: herb.herbId,
          name: herb.name,
          doseRaw: herb.doseRaw,
        }))
      : []
    if (remove.length === 0 && add.length === 0) continue
    mods.push({
      condition,
      remove,
      add,
      rawText: match[0],
    })
  }
  return mods
}

export interface ParsedFormulaBlock {
  name: string
  herbs: FormulaHerb[]
  preparation: string
  modifications: Modification[]
  /** 方名后的主治说明行（不进药味、不进煎服法） */
  indication?: string
  /** 无法经 herb-lexicon 解析为已知药物的药味原文（诊断用） */
  unresolvedHerbTokens: string[]
  /** 本方实际消费的方名 / 药味 / 煎服法原文行（不含主治行），供调用方从条文中剔除 */
  sourceLines: string[]
  /** 方名小标题后的校注：「土瓜根方（附方佚）」→「附方佚」 */
  headingNote?: string
  /** 小标题注明原方佚失：herbs 为空，不补造组成 */
  lost?: boolean
}

export interface FormulaHeading {
  name: string
  headingNote?: string
  lost: boolean
}

/** 已简体化的行 → 方名小标题；非小标题返回 null */
function matchFormulaHeading(line: string): FormulaHeading | null {
  const classic = line.match(FORMULA_NAME_RE)
  if (classic) return { name: classic[1]!.replace(/方$/, ''), lost: false }
  const fang = line.match(FANG_HEADING_RE)
  if (!fang) return null
  const name = fang[1]!
  if (FANG_HEADING_FORBIDDEN_LEADS.includes(name[0]!)) return null
  const headingNote = fang[2]?.trim()
  return {
    name,
    ...(headingNote ? { headingNote } : {}),
    lost: Boolean(headingNote && LOST_FORMULA_ANNOTATION_RE.test(headingNote)),
  }
}

export function parseFormulaHeading(line: string): FormulaHeading | null {
  return matchFormulaHeading(toSimplifiedChinese(line).trim())
}

interface TextSegment {
  /** 不含分隔符的片段 */
  text: string
  /** 含其后分隔符的原文 */
  raw: string
}

/** 按括号外的逗号 / 句号切分，保留分隔符以便原样拼回 */
function splitTopLevelSentences(line: string): TextSegment[] {
  const segments: TextSegment[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '（' || char === '(') depth += 1
    else if (char === '）' || char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && /[，,。]/.test(char)) {
      const raw = line.slice(start, index + 1)
      const text = raw.slice(0, -1).trim()
      if (text) segments.push({ text, raw })
      start = index + 1
    }
  }
  const tail = line.slice(start)
  if (tail.trim()) segments.push({ text: tail.trim(), raw: tail })
  return segments
}

export interface InlineHerbPreparation {
  /** 药味片段（药名+剂量）：「大猪胆一枚」 */
  herbText: string
  /** 药味与制法之间的炮制语原文：「大猪胆一枚，泻汁」 */
  herbRawText: string
  processing?: string
  preparation: string
}

/**
 * 「大猪胆一枚，泻汁，和少许法醋，以灌谷道内。」：药味与制法写在同一行。
 * 仅当首段是带剂量的已知药、其后只有短炮制语、再接制法动作，且制法中没有第二味带剂量的药时拆开；
 * 否则返回 null（普通药味行「茯苓四两，桂枝三两」不受影响）。
 */
export function splitInlineHerbPreparation(line: string): InlineHerbPreparation | null {
  if (!/。/.test(line)) return null
  const [head, ...rest] = splitTopLevelSentences(line)
  if (!head || rest.length === 0) return null
  if (!tokenHasExplicitDose(head.text)) return null
  const parsed = parseHerbToken(head.text)
  if (!parsed || !resolveKnownHerbName(parsed.name)) return null

  let cursor = 0
  const processingParts: string[] = []
  while (cursor < rest.length && !INLINE_PREP_LEAD_RE.test(rest[cursor]!.text)) {
    const text = rest[cursor]!.text
    if (text.length > INLINE_PROCESSING_MAX_LENGTH || tokenHasExplicitDose(text)) return null
    processingParts.push(text)
    cursor += 1
  }
  if (cursor >= rest.length) return null
  const prepSegments = rest.slice(cursor)
  const hasSecondDosedHerb = prepSegments.some((segment) => {
    // 「内甘草二两」：去掉起首动作词再看是否「已知药+剂量」
    const body = segment.text.replace(INLINE_PREP_LEAD_RE, '')
    return tokenHasExplicitDose(body) && startsWithKnownHerb(body)
  })
  if (hasSecondDosedHerb) return null
  const processing = processingParts.join('，')
  return {
    herbText: head.text,
    herbRawText: [head.text, ...processingParts].join('，'),
    ...(processing ? { processing } : {}),
    preparation: prepSegments.map((segment) => segment.raw).join('').trim(),
  }
}

/**
 * 「妇人中裈近隐处，取烧作灰。」+「上一味……」：无剂量的单味描述行。
 * 从行首取最长的已知药名（须与原文写法一致，不走别名模糊匹配），其余文字记为炮制；
 * 取不到已知药名时返回 null，不猜测药名。
 */
export function parseSingleHerbDescription(line: string): FormulaHerb | null {
  const rawText = line.trim()
  const text = rawText.replace(/[。.]+$/, '')
  const maxLength = Math.min(MAX_DESCRIBED_HERB_NAME_LENGTH, text.length)
  for (let length = maxLength; length >= MIN_DESCRIBED_HERB_NAME_LENGTH; length -= 1) {
    const candidate = text.slice(0, length)
    if (!new RegExp(`^[${CJK}]+$`).test(candidate)) continue
    if (resolveKnownHerbName(candidate) !== candidate) continue
    const processing = text.slice(length).replace(/^[，,、\s]+/, '').trim()
    return {
      herbId: candidate.normalize('NFKC'),
      name: candidate,
      rawText,
      doseRaw: '',
      ...(processing ? { processing } : {}),
    }
  }
  return null
}

export interface ExtractFormulaBlocksOptions {
  /**
   * 药名必须可解析：无法经 herb-lexicon 解析的药味不放进 herbs，只记入 unresolvedHerbTokens。
   * 默认关闭，以免词表未收录的后世药名在其他书中被误删。
   */
  requireKnownHerb?: boolean
  /** 煎服法开始后遇空行即结束本方（维基文库以空行分隔方剂与下一条文） */
  stopAtBlankLineAfterPreparation?: boolean
}

/** 按 herb-lexicon 把药味分为可解析 / 不可解析两组 */
export function partitionHerbsByLexicon(herbs: FormulaHerb[]): {
  resolved: FormulaHerb[]
  unresolved: FormulaHerb[]
} {
  const resolved: FormulaHerb[] = []
  const unresolved: FormulaHerb[] = []
  for (const herb of herbs) {
    if (resolveKnownHerbName(herb.name)) {
      resolved.push(herb)
      continue
    }
    const recovered = recoverKnownHerb(herb)
    if (recovered) resolved.push(recovered)
    else unresolved.push(herb)
  }
  return { resolved, unresolved }
}

/** 空行之后的下一行是否仍属本方：已有药味时接受药味 / 煎服法，否则只接受药味 */
function looksLikeBlockContinuation(next: string, hasHerbs: boolean): boolean {
  if (matchFormulaHeading(next)) return true
  // 「上药各须精新，先捣大黄……」：无味数的煎服法起句
  if (hasHerbs && (isPrepLine(next) || /^(?:上|右)(?:药|件)/.test(next))) return true
  if (/主之|不可与|方见/.test(next) || CLAUSE_START_RE.test(next)) return false
  return (
    startsWithKnownHerb(next) ||
    new RegExp(`^[${CJK}]{1,8}?${DOSE_BODY}`).test(next)
  )
}

/** 行首第一味能解析为已知药物：「麻黄　芍药　黄耆各三两……煎取一升」仍是药味行 */
function startsWithKnownHerb(line: string): boolean {
  const first = splitHerbLine(line)[0]
  if (!first) return false
  const parsed = parseHerbToken(first)
  return Boolean(parsed && resolveKnownHerbName(parsed.name))
}

function isPrepLine(line: string): boolean {
  if (PREP_START_RE.test(line)) return true
  if (PREP_INSTRUCTION_RE.test(line)) return true
  // 「分温三服」等煎服法续句
  if (/^(?:分温|温服|去滓|煮取|煎取|顿服)/.test(line)) return true
  // 含大量煎服法动词且不像「药名+剂量」起头
  if (
    /(?:去滓|温服|分温|顿服|渍一宿|煮取|煎取)/.test(line) &&
    !new RegExp(`^[${CJK}]{1,8}[一二三四五六七八九十百半两\\d]`).test(line) &&
    !/各(?:等分|两|升|合|枚|分)/.test(line)
  ) {
    return true
  }
  return false
}

function looksLikeHerbLine(line: string): boolean {
  if (isPrepLine(line)) return false
  if (/主之|不可与|方见/.test(line)) return false
  if (/^即前|^即方/.test(line)) return false
  if (
    new RegExp(`[一二三四五六七八九十半\\d]+(?:${DOSE_UNITS})`).test(line) ||
    /鸡子|弹丸|弹子|等分/.test(line)
  ) {
    return true
  }
  // 短行、多药名并列且尚无煎服法
  if (line.length < 40 && new RegExp(`[${CJK}]{2}`).test(line) && !/(?:煮|煎|服|滓|主之)/.test(line)) {
    return true
  }
  return false
}

export function extractFormulaBlocks(
  body: string,
  options: ExtractFormulaBlocksOptions = {},
): ParsedFormulaBlock[] {
  const simplified = toSimplifiedChinese(body)
  const trimmedLines = simplified.split('\n').map((line) => line.trim())
  // 默认丢弃空行（与旧行为一致）；按空行断方时保留空行作边界
  const lines = options.stopAtBlankLineAfterPreparation
    ? trimmedLines
    : trimmedLines.filter(Boolean)

  const blocks: ParsedFormulaBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const heading = line ? matchFormulaHeading(line) : null
    if (!heading) {
      i += 1
      continue
    }
    const name = heading.name
    i += 1
    if (heading.lost) {
      // 原方佚：不吞并其后任何行，以免把下一方或条文当成组成
      blocks.push({
        name,
        herbs: [],
        preparation: '',
        modifications: [],
        unresolvedHerbTokens: [],
        sourceLines: [line],
        headingNote: heading.headingNote,
        lost: true,
      })
      continue
    }
    const herbLines: string[] = []
    const prepLines: string[] = []
    const indicationLines: string[] = []
    let inlineSplit: (InlineHerbPreparation & { source: string }) | null = null
    while (i < lines.length) {
      const current = lines[i]!
      if (!current) {
        if (prepLines.length > 0) break
        // 空行后若不是本方的药味 / 煎服法，视为已进入下一条文
        let nextIndex = i + 1
        while (nextIndex < lines.length && !lines[nextIndex]) nextIndex += 1
        const next = lines[nextIndex]
        if (!next || !looksLikeBlockContinuation(next, herbLines.length > 0)) break
        i += 1
        continue
      }
      if (matchFormulaHeading(current)) break
      if (herbLines.length === 0 && prepLines.length === 0 && INDICATION_LINE_RE.test(current)) {
        indicationLines.push(current)
        i += 1
        continue
      }
      if (herbLines.length === 0 && prepLines.length === 0 && !isPrepLine(current)) {
        const inline = splitInlineHerbPreparation(current)
        if (inline) {
          inlineSplit = { ...inline, source: current }
          herbLines.push(inline.herbText)
          prepLines.push(inline.preparation)
          i += 1
          continue
        }
      }
      // 已有药味后遇到下一条文，结束本方；「右六味……皆主之」是煎服法，不是条文
      if (
        herbLines.length > 0 &&
        !PREP_START_RE.test(current) &&
        (CLAUSE_START_RE.test(current) || /主之|不可与|方见/.test(current))
      ) {
        break
      }
      if (
        prepLines.length === 0 &&
        !PREP_START_RE.test(current) &&
        !PREP_INSTRUCTION_RE.test(current) &&
        !/主之|不可与|方见/.test(current) &&
        startsWithKnownHerb(current)
      ) {
        herbLines.push(current)
        i += 1
        continue
      }
      if (
        !isPrepLine(current) &&
        herbLines.length > 0 &&
        prepLines.length > 0 &&
        current.length > 18 &&
        !/两|升|枚|味|煮|服/.test(current.slice(0, 8))
      ) {
        break
      }
      if (isPrepLine(current) || prepLines.length > 0) {
        prepLines.push(current)
      } else if (looksLikeHerbLine(current)) {
        herbLines.push(current)
      } else if (herbLines.length === 0 && current.length < 40 && !CLAUSE_START_RE.test(current)) {
        herbLines.push(current)
      } else {
        prepLines.push(current)
      }
      i += 1
    }
    let herbs = herbLines.flatMap((item) => parseHerbLine(item))
    if (inlineSplit && herbs.length === 1) {
      const [herb] = herbs
      herbs = [
        {
          ...herb!,
          rawText: inlineSplit.herbRawText,
          ...(inlineSplit.processing
            ? { processing: [herb!.processing, inlineSplit.processing].filter(Boolean).join('、') }
            : {}),
        },
      ]
    }
    const preparation = prepLines.join('')
    herbs = applyEqualDoseFromPreparation(herbs, preparation)
    herbs = herbs.filter(
      (herb) => !isSpuriousHerbName(herb.name) && !isPrepOrMetaIgnoringNote(herb.rawText),
    )
    if (herbs.length === 0 && herbLines.length === 1 && SINGLE_HERB_PREP_RE.test(preparation)) {
      const described = parseSingleHerbDescription(herbLines[0]!)
      if (described) herbs = [described]
    }
    const { resolved, unresolved } = partitionHerbsByLexicon(herbs)
    if (options.requireKnownHerb) herbs = resolved
    if (herbs.length === 0 && preparation.length === 0) continue
    const consumedLines = inlineSplit
      ? [inlineSplit.source, ...herbLines.slice(1), ...prepLines.slice(1)]
      : [...herbLines, ...prepLines]
    blocks.push({
      name,
      herbs,
      preparation,
      modifications: parseModifications(preparation),
      indication: indicationLines.length > 0 ? indicationLines.join('') : undefined,
      unresolvedHerbTokens: unresolved.map((herb) => herb.rawText),
      sourceLines: [line, ...consumedLines],
    })
  }
  return blocks
}

/** 「（一方，水酒各四升）」「以水、清酒各一升」：该位置所在分句说的是溶剂用量 */
function isSolventClause(text: string, index: number): boolean {
  const clauses = text.slice(0, index).split(PREP_CLAUSE_BOUNDARY_RE)
  return SOLVENT_CLAUSE_RE.test(clauses[clauses.length - 1] ?? '')
}

/**
 * 煎服法中是否有指向药物的「等分」：各等分、「上四味……等分」，或药味全无剂量时的任一「等分」；
 * 「水酒各等分」「水酒等分煎」量的是溶剂，不算。
 */
function hasHerbEqualFen(text: string, allHerbsMissingDose: boolean): boolean {
  for (const match of text.matchAll(/等分/g)) {
    if (isSolventClause(text, match.index)) continue
    const before = text.slice(0, match.index)
    if (before.endsWith('各') || STATED_COUNT_BEFORE_EQUAL_FEN_RE.test(before) || allHerbsMissingDose) {
      return true
    }
  }
  return false
}

/** 「上四味，各十分 / 等分」：煎服法中的等量说明回填到无剂量药味 */
export function applyEqualDoseFromPreparation(
  herbs: FormulaHerb[],
  preparation: string,
): FormulaHerb[] {
  if (herbs.length === 0) return herbs
  const missing = herbs.filter((herb) => !herb.doseRaw)
  if (missing.length === 0) return herbs

  const text = toSimplifiedChinese(preparation)
  let shared: string | undefined
  if (hasHerbEqualFen(text, missing.length === herbs.length)) {
    shared = '等分'
  } else {
    const match = [...text.matchAll(SHARED_DOSE_AFTER_GE_RE)].find(
      (candidate) => !isSolventClause(text, candidate.index),
    )
    // 排除「各别捣筛」这类非剂量「各」
    if (match && !/^(别|分別|各别)/.test(text.slice(text.indexOf('各') + 1))) {
      shared = match[1]
    }
  }
  if (!shared) {
    // 「葵子，茯苓三两」：仅一味有剂量且味数吻合时，回填到无剂量者。
    // 省文只承后不承前：「赤小豆三升……当归」的当归不应得「三升」
    const dosed = herbs.filter((herb) => herb.doseRaw)
    const dosedIndex = herbs.findIndex((herb) => herb.doseRaw)
    const missingAllBeforeDosed = herbs.every((herb, index) => herb.doseRaw || index < dosedIndex)
    if (
      dosed.length === 1 &&
      missing.length >= 1 &&
      missing.length + dosed.length === herbs.length &&
      missingAllBeforeDosed
    ) {
      const countMatch = text.match(/(?:上|右|以上)([一二三四五六七八九十百]+)味/)
      const statedCount = countMatch ? chineseCountToNumber(countMatch[1]!) : undefined
      if (statedCount === herbs.length || herbs.length === 2) {
        shared = dosed[0]!.doseRaw
      }
    }
  }
  if (!shared) return herbs

  const countMatch = text.match(/(?:上|右|以上)([一二三四五六七八九十百]+)味/)
  const statedCount = countMatch ? chineseCountToNumber(countMatch[1]!) : undefined
  if (statedCount !== undefined && statedCount !== herbs.length && statedCount !== missing.length) {
    return herbs
  }

  return herbs.map((herb) => {
    if (herb.doseRaw) return herb
    const dose = parseDose(`${herb.name}${shared}`)
    return {
      ...herb,
      doseRaw: shared,
      doseLiang: dose.doseLiang,
      doseSheng: dose.doseSheng,
      doseCount: dose.doseCount,
      rawText: herb.rawText.includes(shared) ? herb.rawText : injectDoseIntoToken(herb.rawText, shared),
    }
  })
}

function chineseCountToNumber(raw: string): number | undefined {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }
  if (raw === '十') return 10
  if (raw.startsWith('十')) return 10 + (map[raw[1]!] ?? 0)
  if (raw.endsWith('十') && raw.length === 2) return (map[raw[0]!] ?? 0) * 10
  return map[raw]
}

export function isFormulaNameLine(line: string): boolean {
  return parseFormulaHeading(line) !== null
}

export function isPreparationLine(line: string): boolean {
  const text = toSimplifiedChinese(line).trim()
  return PREP_START_RE.test(text) || PREP_INSTRUCTION_RE.test(text)
}

import type { FormulaHerb, Modification } from '../../src/types/data.ts'
import { CJK, DOSE_UNITS } from './cjk.ts'
import {
  extractDoseRaw,
  injectDoseIntoToken,
  parseDose,
  tokenHasExplicitDose,
} from './dose.ts'
import {
  extractProcessing,
  isPrepOrMetaToken,
  isProcessingOnlyToken,
  isSpuriousHerbName,
  parseHerbToken,
} from './herbs.ts'
import { toSimplifiedChinese } from './wiki.ts'

const FORMULA_NAME_RE =
  /^[《]?([\u4e00-\u9fff]{2,20}?(?:汤|散|丸|膏|煎|饮|醴|酒))方?[》]?[：:]*$/
const PREP_START_RE = /^(?:上|右)([一二三四五六七八九十百]+|[0-9]+)味/

/** 上锉 / 右二味 / 以上三味 / 上先以水洗… 等煎服法起句 */
const PREP_INSTRUCTION_RE =
  /^(?:以上|上|右)(?:[一二三四五六七八九十百]+味|锉|先|以|为|杵|捣|筛|每|洗)|^(?:以上|上|右).{0,8}(?:锉|煮取|煎取|以水|先以|为细末|杵为|捣筛|咬咀|㕮咀)/

/** 下一条文起句（勿含百合/奔豚等可作药名或方名开头的词） */
const CLAUSE_START_RE =
  /^(?:伤寒|太阳|阳明|少阳|太阴|少阴|厥阴|问曰|师曰|凡用|病者|妇人中风|妇人妊娠|妇人产后|发汗后|下之后)/

/** 维基宋本常见讹字 / 省文，在切分前归一 */
function normalizeHerbLineSource(line: string): string {
  return line
    .replace(/两檗/g, '黄檗')
    .replace(/兩檗/g, '黄檗')
    // 「桃仁去皮、尖，熬」→ 炮制内顿号改为逗号，避免切成独立药味
    .replace(/去皮、尖/g, '去皮尖')
    .replace(/去皮、尖、/g, '去皮尖、')
    // 「枳实三枚大者」「附子大者一枚」
    .replace(/枚大者/g, '枚（大者）')
    .replace(/枚小者/g, '枚（小者）')
    .replace(/大者(?=[一二三四五六七八九十百])/g, '（大者）')
    .replace(/小者(?=[一二三四五六七八九十百])/g, '（小者）')
}

/** 不在括号内按空白 / 顿号切分 */
export function splitHerbLine(line: string): string[] {
  const cleaned = normalizeHerbLineSource(line)
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
    for (const part of splitGluedHerbToken(token)) tokens.push(part)
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

function looksLikeNextHerbName(text: string): boolean {
  if (!new RegExp(`^[${CJK}]{2,}`).test(text)) return false
  if (text.startsWith('各')) return false
  // 剂量续写：一两十六铢、二两半……
  if (/^[一二三四五六七八九十百半两\d]/.test(text)) return false
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
  return /^(去皮|去心|去节|去尖|去芦|去目|尖|炮|炙|熬|洗|擘|劈|切|破|碎|炒|研|生用|汤泡|酒洗|蜜炙|出汗|绵裹|为膏|为末)/.test(
    simplified,
  )
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

export function parseHerbLine(line: string): FormulaHerb[] {
  const tokens = applyTrailingEqualFen(
    applyGeDosePropagation(mergeProcessingOrphans(splitHerbLine(toSimplifiedChinese(line)))),
  )
  const herbs: FormulaHerb[] = []

  for (const token of tokens) {
    if (isPrepOrMetaToken(token) || isProcessingOnlyToken(token) || isOrphanProcessingFragment(token)) {
      if (herbs.length === 0) continue
      if (isPrepOrMetaToken(token) && !isOrphanProcessingFragment(token) && !isProcessingOnlyToken(token)) {
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

    const normalized = parseHerbToken(token)
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

    const dose = parseDose(token)
    const doseRaw = extractDoseRaw(token) || dose.doseRaw
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
          .filter((item): item is string => Boolean(item) && !isProcessingOnlyToken(item))
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

export function extractFormulaBlocks(body: string): ParsedFormulaBlock[] {
  const simplified = toSimplifiedChinese(body)
  const lines = simplified
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const blocks: ParsedFormulaBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const nameMatch = line.match(FORMULA_NAME_RE)
    if (!nameMatch) {
      i += 1
      continue
    }
    const name = nameMatch[1]!.replace(/方$/, '')
    i += 1
    const herbLines: string[] = []
    const prepLines: string[] = []
    while (i < lines.length) {
      const current = lines[i]!
      if (FORMULA_NAME_RE.test(current)) break
      // 已有药味后遇到下一条文，结束本方
      if (
        herbLines.length > 0 &&
        (CLAUSE_START_RE.test(current) || /主之|不可与|方见/.test(current))
      ) {
        break
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
    const preparation = prepLines.join('')
    herbs = applyEqualDoseFromPreparation(herbs, preparation)
    herbs = herbs.filter((herb) => !isSpuriousHerbName(herb.name) && !isPrepOrMetaToken(herb.rawText))
    if (herbs.length === 0 && preparation.length === 0) continue
    blocks.push({
      name,
      herbs,
      preparation,
      modifications: parseModifications(preparation),
    })
  }
  return blocks
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
  if (/各等分/.test(text) || /(?:上|右)[一二三四五六七八九十百]+味[^。]{0,12}等分/.test(text)) {
    shared = '等分'
  } else if (/等分/.test(text) && missing.length === herbs.length) {
    shared = '等分'
  } else {
    const match = text.match(
      new RegExp(`各(十分|[一二三四五六七八九十百半两\\d.]+(?:${DOSE_UNITS})?)`),
    )
    // 排除「各别捣筛」这类非剂量「各」
    if (match && !/^(别|分別|各别)/.test(text.slice(text.indexOf('各') + 1))) {
      shared = match[1]
    }
  }
  if (!shared) {
    // 「葵子，茯苓三两」：仅一味有剂量且味数吻合时，回填到无剂量者
    const dosed = herbs.filter((herb) => herb.doseRaw)
    if (
      dosed.length === 1 &&
      missing.length >= 1 &&
      missing.length + dosed.length === herbs.length
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
  return FORMULA_NAME_RE.test(toSimplifiedChinese(line).trim())
}

export function isPreparationLine(line: string): boolean {
  const text = toSimplifiedChinese(line).trim()
  return PREP_START_RE.test(text) || PREP_INSTRUCTION_RE.test(text)
}

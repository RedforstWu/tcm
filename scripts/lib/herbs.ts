import { CJK, DOSE_BODY, NON_CJK_RE } from './cjk.ts'

export interface NormalizedHerb {
  herbId: string
  name: string
  processing?: string
  note?: string
}

/** 异名与常见错字 → 标准名 */
const HERB_ALIASES: Record<string, string> = {
  栝蒌根: '天花粉',
  瓜蒌根: '天花粉',
  栝楼根: '天花粉',
  括蒌根: '天花粉',
  栝蒌实: '瓜蒌',
  栝楼实: '瓜蒌',
  瓜蒌实: '瓜蒌',
  括蒌实: '瓜蒌',
  栝蒌: '瓜蒌',
  括蒌: '瓜蒌',
  黄岑: '黄芩',
  黄蘗: '黄檗',
  黄柏: '黄檗',
  檗: '黄檗',
  芎䓖: '川芎',
  芎藭: '川芎',
  芎穷: '川芎',
  芎窮: '川芎',
  芎: '川芎',
  䗪虫: '䗪虫',
  蟅虫: '䗪虫',
  䗪蟲: '䗪虫',
  白朮: '白术',
  朮: '白术',
  苍朮: '苍术',
  生薑: '生姜',
  乾姜: '干姜',
  乾薑: '干姜',
  麦门冬: '麦冬',
  天门冬: '天冬',
  薯蕷: '山药',
  薯蓣: '山药',
  署预: '山药',
  秝米: '粳米',
  胶饴: '饴糖',
  饴: '饴糖',
  芒消: '芒硝',
  消石: '硝石',
  蜀椒: '花椒',
  川椒: '花椒',
  生梓白皮: '梓白皮',
  文蛤: '海蛤壳',
  香豉: '豆豉',
  豉: '豆豉',
  牡丹皮: '牡丹皮',
  丹皮: '牡丹皮',
  牡丹: '牡丹皮',
  生地黄: '生地黄',
  干地黄: '干地黄',
  地黄: '地黄',
  麻仁: '火麻仁',
  麻子仁: '火麻仁',
  葶苈: '葶苈子',
  葶苈子: '葶苈子',
  葶历: '葶苈子',
  苇茎: '芦根',
  薏苡: '薏苡仁',
  薏苡仁: '薏苡仁',
  橘皮: '陈皮',
  陈皮: '陈皮',
  葱: '葱白',
  桂: '桂枝',
  参: '人参',
}

const PROCESSING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /炮/, label: '炮' },
  { pattern: /炙/, label: '炙' },
  { pattern: /熬/, label: '熬' },
  { pattern: /烧/, label: '烧' },
  { pattern: /洗/, label: '洗' },
  { pattern: /炒/, label: '炒' },
  { pattern: /研/, label: '研' },
  { pattern: /碎/, label: '碎' },
  { pattern: /破/, label: '破' },
  { pattern: /去皮尖/, label: '去皮尖' },
  { pattern: /去皮/, label: '去皮' },
  { pattern: /去心/, label: '去心' },
  { pattern: /去节/, label: '去节' },
  { pattern: /去尖/, label: '去尖' },
  { pattern: /去芦/, label: '去芦' },
  { pattern: /去目汗|去目及汗|去目/, label: '去目' },
  { pattern: /去汁/, label: '去汁' },
  { pattern: /擘|劈/, label: '擘' },
  { pattern: /切/, label: '切' },
  { pattern: /酒洗/, label: '酒洗' },
  { pattern: /蜜炙/, label: '蜜炙' },
  { pattern: /汤泡/, label: '汤泡' },
  { pattern: /生用/, label: '生用' },
  { pattern: /出汗/, label: '出汗' },
  { pattern: /绵裹/, label: '绵裹' },
]

/** 单独出现时不应被视为药名的炮制用语 */
const PROCESSING_ONLY_NAMES = new Set([
  '去皮',
  '去心',
  '去节',
  '去尖',
  '去芦',
  '去皮尖',
  '去目',
  '去目汗',
  '去汁',
  '尖',
  '大者',
  '小者',
  '炮',
  '炙',
  '熬',
  '烧',
  '洗',
  '擘',
  '劈',
  '切',
  '破',
  '碎',
  '炒',
  '研',
  '酒洗',
  '蜜炙',
  '汤泡',
  '生用',
  '出汗',
  '绵裹',
  '末',
  '咬咀',
  '㕮咀',
  '为膏',
  '为末',
  '为散',
])

/** 非药味残片（版刻/标记噪声） */
const SPURIOUS_HERB_NAMES = new Set([
  '条',
  '取',
  '每',
  '差',
  '汁',
  '煎',
  '煮',
  '虫',
  '两',
  '升',
  '麻',
  '檗',
])

function toHerbId(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '')
}

export function isProcessingOnlyToken(raw: string): boolean {
  const trimmed = raw.trim()
  // 纯剂量残片（如误切出的「两」「三两」）不是炮制
  if (
    new RegExp(
      `^(?:各)?(?:等分|两半|[一二三四五六七八九十百半两\\d.]+(?:两|升|合|枚|分|斤|铢|株|钱|个|箇|茎|把|尺|片|斗|粒|匕)?)$`,
    ).test(trimmed.replace(/[（()）]/g, ''))
  ) {
    return false
  }
  const cleaned = trimmed
    .replace(/[（()）]/g, '')
    .replace(/[、，,\s]/g, '')
    .replace(/[一二三四五六七八九十半两\d.]+(两|升|合|枚|分|斤|铢|钱|斗|粒)?/g, '')
    .replace(/片|枚|个/g, '')
    .trim()
  if (!cleaned) return true
  if (PROCESSING_ONLY_NAMES.has(cleaned)) return true
  // 「炮去皮破八片」「熬研如脂」等纯炮制串
  const withoutProcessing = PROCESSING_PATTERNS.reduce(
    (text, item) => text.replace(item.pattern, ''),
    cleaned,
  ).replace(/如脂|八片|香/g, '')
  return withoutProcessing.length === 0
}

export function isSpuriousHerbName(name: string): boolean {
  if (!name) return true
  if (SPURIOUS_HERB_NAMES.has(name)) return true
  if (
    /^(?:去滓|温服|温再服|顿服|顿服之|渍一宿|分温|分温再服|分温三服|煮取|煎取|煎至|上锉|右锉|以水|水盏|水盏半|汗出愈|将息|后合|后合和|当白沫出|去其水|内鸡子黄|搅匀|有微汗|避风|良久再服|从腰下如冰|后坐被上|温令微汗|外研如脂|八月采|七月七日采|三月三日采|除日及闭口者|以上三味|右四味|右五味|即前|即前方|即前小青龙汤加石膏|胸满者|腹满者|大便秘结者|肺气虚损者|去大枣|得吐者止后服|分二服温进一服|妇人中裈近隐处|取烧作灰|杏仁五十粒|大者|小者|去汁)$/.test(
      name,
    )
  ) {
    return true
  }
  if (/采|採/.test(name) && name.length <= 6) return true
  // 条文句子误入
  if (/主之|不可与|方见|伤寒|凡用|医以|身热|微烦|里水|虚劳|腰痛|少腹|小便不利|其脉|黄肿/.test(name)) {
    return true
  }
  if (/^即前|^即方|^深师|^并为/.test(name)) return true
  // 「附子大者」应已剥成附子；残留则剔除
  if (/大者$|小者$/.test(name)) return true
  return false
}

/** 煎服法 / 采收说明等，不应进入药味 */
export function isPrepOrMetaToken(token: string): boolean {
  const text = token.trim()
  if (!text) return true
  if (isProcessingOnlyToken(text)) return true
  if (isSpuriousHerbName(text.replace(/[（()）].*$/, '').trim())) return true
  if (/^(?:上|右)(?:[一二三四五六七八九十百]+味|锉|先|以|为|杵|捣|筛|每)/.test(text)) {
    return true
  }
  if (/(?:去滓|温服|渍一宿|分温再服|顿服|煮取|煎取|将息)/.test(text) && text.length > 4) {
    return true
  }
  if (/^(?:八月|七月|三月|除日)/.test(text)) return true
  return false
}

export function canonicalizeHerbName(rawName: string): string {
  const cleaned = rawName
    .replace(/[（(].*?[）)]/g, '')
    .replace(NON_CJK_RE, '')
    .trim()
  if (!cleaned) return ''
  if (isProcessingOnlyToken(cleaned)) return ''
  if (isSpuriousHerbName(cleaned)) return ''
  if (HERB_ALIASES[cleaned]) return HERB_ALIASES[cleaned]
  for (const [alias, standard] of Object.entries(HERB_ALIASES)) {
    if (alias.length >= 2 && cleaned.includes(alias) && cleaned.length <= alias.length + 2) {
      return standard
    }
  }
  // 单字别名（芎→川芎）仅在完全相等时生效，避免误伤
  if (cleaned.length === 1 && HERB_ALIASES[cleaned]) return HERB_ALIASES[cleaned]
  return cleaned
}

export function extractProcessing(rawText: string): string | undefined {
  const labels = PROCESSING_PATTERNS.filter((item) => item.pattern.test(rawText)).map(
    (item) => item.label,
  )
  if (labels.length === 0) return undefined
  return [...new Set(labels)].join('、')
}

/** 剥掉剂量后紧跟的无括号炮制：蜀椒二合去目汗 */
export function peelInlineProcessing(token: string): { core: string; processing?: string } {
  const trimmed = token.trim()
  const paren = trimmed.match(/^(.+?)([（(].*[）)])$/)
  const main = paren ? paren[1]! : trimmed
  const suffix = paren ? paren[2]! : ''

  const inlineMatch = main.match(
    new RegExp(
      `^([${CJK}].+?)(去目汗|去目及汗|去目|去皮尖|去皮|去心|去节|去尖|去芦|去汁|出汗|大者|小者)$`,
    ),
  )
  if (inlineMatch) {
    const left = inlineMatch[1]!
    const core = `${left}${suffix}`
    // 有剂量，或左侧已是完整药名时剥离炮制尾巴（桃仁去皮尖）
    if (
      /[一二三四五六七八九十百半两\d]/.test(left) ||
      /等分/.test(left) ||
      (left.length >= 2 && !PROCESSING_ONLY_NAMES.has(left))
    ) {
      return { core, processing: inlineMatch[2] }
    }
  }
  return { core: trimmed }
}

/**
 * 从「桂枝三两（去皮）」一类片段解析药名。
 */
export function parseHerbToken(token: string): NormalizedHerb | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  if (isProcessingOnlyToken(trimmed)) return null
  if (isPrepOrMetaToken(trimmed)) return null

  const peeled = peelInlineProcessing(trimmed)
  const working = peeled.core

  const parenMatch = working.match(/^(.+?)([（(].*[）)])$/)
  const main = parenMatch ? parenMatch[1]!.trim() : working
  const note = parenMatch ? parenMatch[2]!.replace(/[（()）]/g, '').trim() : undefined

  // 先去掉夹在药名与剂量之间的炮制：牡蛎熬等分 / 桃仁去皮尖等分
  let workingMain = main
  const midProc = workingMain.match(
    new RegExp(
      `^([${CJK}]{2,8})(去目汗|去皮尖|去皮|去心|去节|去尖|去芦|去汁|熬|洗|炙|炮|烧|切|擘|碎|研)(?=${DOSE_BODY}|各|$)`,
    ),
  )
  let midProcessing: string | undefined
  if (midProc) {
    workingMain = `${midProc[1]}${workingMain.slice(midProc[0].length)}`
    midProcessing = midProc[2]
  }
  const doseMatch = workingMain.match(
    new RegExp(`^([${CJK}]{1,8}?)((?:各)?(?:${DOSE_BODY}).*)$`),
  )

  let namePart = workingMain
  if (doseMatch?.[1]) {
    namePart = doseMatch[1]
  } else {
    namePart = workingMain.replace(new RegExp(`(?:各)?(?:${DOSE_BODY}).*$`), '')
  }

  namePart = namePart.replace(/各$/, '').trim()
  // 无剂量时再剥炮制尾巴：桃仁去皮尖
  const tailProc = namePart.match(
    new RegExp(`^([${CJK}]{2,8})(去目汗|去皮尖|去皮|去心|去节|去尖|去芦|去汁)$`),
  )
  if (tailProc) {
    namePart = tailProc[1]!
    midProcessing = midProcessing ?? tailProc[2]
  }
  const name = canonicalizeHerbName(namePart)
  if (!name || isProcessingOnlyToken(name) || isSpuriousHerbName(name)) return null

  const processing =
    extractProcessing(trimmed) ??
    (midProcessing ? extractProcessing(midProcessing) : undefined) ??
    (peeled.processing ? extractProcessing(peeled.processing) : undefined) ??
    (note ? extractProcessing(note) : undefined)

  return {
    herbId: toHerbId(name),
    name,
    processing,
    note,
  }
}

export function listKnownHerbs(): string[] {
  return [...new Set(Object.values(HERB_ALIASES))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

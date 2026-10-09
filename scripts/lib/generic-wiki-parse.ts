import type { BookId, Clause, Formula, FormulaHerb } from '../../src/types/data.ts'
import { parseHerbLine } from './formula-parse.ts'
import { toSimplifiedChinese } from './wiki.ts'

export interface WikiSection {
  title: string
  level: number
  body: string
  order: number
}

/** 维基元信息/导航模板：可跨行、可嵌套（header 内含 Textquality），整段删除 */
const WIKI_META_TEMPLATE_RE =
  /\{\{\s*(?:header2?|footer|檢索|检索|Textquality|NoteTA|Wikipedia|未校[訂订]|PD-old|zth|Split|醫療|医疗|[傳传]統漢字|传统汉字)\s*(?:\|[^{}]*)?\}\}/gi
/** 嵌套元模板最多剥几层（实测 header→Textquality 两层） */
const MAX_META_TEMPLATE_PASSES = 4
/** 显示内容即正文的模板：{{*|小字注}}、{{YL|年号}} */
const WIKI_INLINE_CONTENT_TEMPLATE_RE = /\{\{\s*(?:\*|YL)\s*\|([^{}]*)\}\}/gi

function stripWikiMetaTemplates(text: string): string {
  let current = text
  for (let pass = 0; pass < MAX_META_TEMPLATE_PASSES; pass += 1) {
    const next = current.replace(WIKI_META_TEMPLATE_RE, '\n')
    if (next === current) break
    current = next
  }
  return current
}

/** 去掉维基/四库常见噪声，保留可读正文 */
export function cleanWikiBody(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  text = text.replace(/\{\{SKQS\s+header\|[^}]*\}\}/gi, '\n')
  text = text.replace(/\{\{SKQS\s+footer\|[^}]*\}\}/gi, '\n')
  text = text.replace(/\{\{SK\s*notes\|[^}]*\}\}/gi, '')
  text = text.replace(/\{\{SKchar2?\|[^}]*\}\}/gi, '□')
  text = text.replace(/\{\{SK\s*list\|[^}]*\}\}/gi, '\n')
  text = text.replace(WIKI_INLINE_CONTENT_TEMPLATE_RE, '$1')
  text = stripWikiMetaTemplates(text)
  text = text.replace(/\{\{[^}|\n]{0,100}\}\}/g, '')
  text = text.replace(/<\/?poem>/gi, '\n')
  text = text.replace(/<\/?onlyinclude>/gi, '\n')
  text = text.replace(/\[\[(?:File|Image|文件|图像):[^\]]+\]\]/gi, '')
  text = text.replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, '$1')
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1')
  text = text.replace(/'{2,}/g, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/?font[^>]*>/gi, '')
  text = text.replace(/-\{([^}]*)\}-/g, '$1')
  text = text.replace(/请根据四库全书扫描版校对本页[^\n]*/g, '')
  text = text.replace(/标准见[^\n]*/g, '')
  text = text.replace(/<!--[\s\S]*?-->/g, '\n')
  // 行首/行尾全角空格是排版缩进，删去；行内全角空格是药味/词语分隔（千金「桑寄生　白石英」），折成半角空格
  text = text.replace(/^[　\t]+|[　\t]+$/gm, '')
  text = text.replace(/[　\t]+/g, ' ')
  return text
}

export interface WikiHeading {
  title: string
  level: number
  /** 标题行起点 */
  start: number
  /** 标题行终点（不含换行） */
  end: number
}

const WIKI_HEADING_LINE_RE = /^(={2,6})\s*(.+?)\s*\1\s*$/gm

/** 列出全部 == … == 标题行（2~6 级），按出现顺序 */
export function listWikiHeadings(text: string): WikiHeading[] {
  const headings: WikiHeading[] = []
  const re = new RegExp(WIKI_HEADING_LINE_RE.source, 'gm')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    headings.push({
      title: match[2]!.trim(),
      level: match[1]!.length,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return headings
}

/** 去掉正文中残留的整行维基标题（只删标记行，不动其余文字） */
export function stripWikiHeadingLines(text: string): string {
  return text.replace(new RegExp(WIKI_HEADING_LINE_RE.source, 'gm'), '')
}

export interface WikiHeadingUnit {
  title: string
  level: number
  /** 标题行起点 */
  start: number
  /** 标题行之后、下一个任意级标题之前的正文（已 trim） */
  body: string
  /** 非条文级标题直接带的正文（如三级「产后总论」下无四级小节） */
  orphan: boolean
}

/**
 * 按标题切分：clauseLevel 级标题各成一单元（无论正文长短，保持序号），
 * 正文止于下一个任意级标题，避免把下一节标题/章名并入；
 * 其他级标题若直接带正文（≥ minOrphanLength），记为 orphan 单元，免得并入上一条或丢失。
 */
export function splitHeadingUnits(
  text: string,
  clauseLevel: number,
  minOrphanLength: number,
): WikiHeadingUnit[] {
  const headings = listWikiHeadings(text)
  const units: WikiHeadingUnit[] = []
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!
    const bodyEnd = headings[index + 1]?.start ?? text.length
    const body = text.slice(heading.end, bodyEnd).trim()
    const orphan = heading.level !== clauseLevel
    if (orphan && body.length < minOrphanLength) continue
    units.push({ title: heading.title, level: heading.level, start: heading.start, body, orphan })
  }
  return units
}

/** 按 == / === 标题切段 */
export function splitWikiSections(raw: string): WikiSection[] {
  const text = toSimplifiedChinese(cleanWikiBody(raw)).replace(/\r\n/g, '\n')
  const headingRe = /^(={2,4})\s*(.+?)\s*\1\s*$/gm
  const marks: Array<{ title: string; level: number; index: number; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = headingRe.exec(text)) !== null) {
    marks.push({
      title: match[2]!.trim(),
      level: match[1]!.length,
      index: match.index,
      end: match.index + match[0].length,
    })
  }
  if (marks.length === 0) {
    const body = text.trim()
    return body ? [{ title: '正文', level: 2, body, order: 1 }] : []
  }

  const sections: WikiSection[] = []
  for (let i = 0; i < marks.length; i += 1) {
    const current = marks[i]!
    const next = marks[i + 1]
    const body = text.slice(current.end, next?.index ?? text.length).trim()
    if (!body || body.length < 20) continue
    if (/^目录|^目錄|^凡例|^序$|^跋$|^全覽/.test(current.title)) continue
    sections.push({
      title: current.title,
      level: current.level,
      body,
      order: sections.length + 1,
    })
  }
  return sections
}

/** 粗切段落为条文候选（空行或较长停顿） */
export function splitParagraphs(body: string, minLength = 24): string[] {
  return cleanWikiBody(body)
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n+/g, '').trim())
    .filter((part) => {
      if (part.length >= minLength) return true
      // 短方块常只有「【某方】即于…加…」，勿因不足 24 字丢条文
      if (/【[^】]{2,40}(?:汤|散|丸|膏|煎|饮|丹)方?】/.test(part) && part.length >= 10) {
        return true
      }
      return false
    })
}

/** 非方名黑名单：叙述词、页脚、泛称 */
const FAKE_FORMULA_RE =
  /^(一方|上方|后方|本方|此方|其方|煎方|汤方|又方|前方|古方|今方|秘方|良方|验方|成方|大方|小方|奇方|偶方|复方|单方|医方|药方|诸方|用方|立方|拟方|原方|新方|旧方|别方|如方|依方|按方|右方|左方|见方|详见方|附方|附录方|目录方|正文方|提要方|凡例方|序方|跋方|卷方|部方|章方|节方|请根据|四库|扫描|校对|标准见|维基|百科)/

/** 话语片段：把叙述句误当成方名 */
const DISCOURSE_FORMULA_RE =
  /此方|一方|本方|上方|用此|拟此|按此|绝无|可用|愚按|已上|为制|为拟|审斯|近年|以后|亦用|亦治|授以|方书|十余味|外感第|必用此|不宜|世医|仍用|宜此|景岳云|柯韵|拙拟|因拟|愚以|愚用|加入此|称此方|知此方|格此方|者此方|云此方|当去|庶乎|内有|呕而|因为制|或十余|宜本方|阳毒用|按此三阳|已上方|同煎|去滓|温服|无时|碾为末|酒调|稍散|再滴水|不愈|定一煎|速与|暂以|四柱六柱/

/** 服法/剂量/截断伪方名（千金提及、金鉴方论残片等） */
const SPURIOUS_FORMULA_EXACT = new Set([
  '三物水煎',
  '枣肉为小丸',
  '加猪胆汁汤',
  '苓甘术汤',
  '开骨散',
  '铜器微火煎',
  '麻子大一丸',
  '芥子七丸',
  '枣大二丸',
  '马齿菜捣汁煎',
  '速与续命汤',
])

export function isPlausibleFormulaName(name: string): boolean {
  const n = name.replace(/湯/g, '汤').replace(/飲/g, '饮').replace(/[【】\[\]]/g, '').trim()
  if (n.length < 2 || n.length > 12) return false
  if (/[【】\[\]0-9]/.test(name)) return false
  if (FAKE_FORMULA_RE.test(n)) return false
  if (DISCOURSE_FORMULA_RE.test(n)) return false
  if (SPURIOUS_FORMULA_EXACT.has(n)) return false
  // 叙述残片 / 单味误作膏剂 / 加减指令 / 剂量伪方名
  if (
    /石膏$|冰糖|砂罐|浓煎|徐徐|少饮|此二药|开其寒|过若干|酌加|^加生|^加人参汤$|^加猪胆|上焦痰|苦寒升|三阳发|辛凉发|辛凉解|无庸|丈夫病|而愈|主是丸|莲心散煎|童子小便|生姜半斤|荷叶裹|一大碗|一大剂|各一钱|一盏煎|半斤同|查浓煎|再剉|猪前蹄|煮汤$|又发红丹|五六钱|汁泛丸|哮喘伏|此药收效|刺去其血|风药以|无效乃作|温补与|杂矣乃与|子悬以|捣散$|捣汁煎$|微火煎$|水煎$|铜器|地冬汁膏|水[一二三四五六七八九十]+盏煎|三钱水|四合煎|^于[凉温]|^得养|^乃[寿夀]|以前汤|以前方|即瘥|蜜酥|金钥匙|二圣散|芦荟二丸|六君子送|^大小|送二神|苓甘术汤|开骨散/.test(
      n,
    )
  ) {
    return false
  }
  // 「一二匙蜜酥煎」「六钱木香化滞汤」「一合即瘥黄芪散」——剂量/服法冠于方名
  if (/^[一二三四五六七八九十百半]+(?:两|钱|匙|合|斤)/.test(n)) return false
  if (/[一二三四五六七八九十百半两斤匙钱合]/.test(n) && /匙|即瘥|送/.test(n)) return false
  // 「麻子大一丸」「枣大二丸」「芥子七丸」——丸剂大小/粒数，非方名
  if (/(?:麻子|芥子|枣)大?[一二三四五六七八九十百]+丸$/.test(n)) return false
  if (/大[一二三四五六七八九十百]+丸$/.test(n) && /麻|枣|芥|梧|弹|豆/.test(n)) return false
  if (/^加.{1,4}膏$/.test(n)) return false
  // 「小柴胡合桂枝汤」「补中益气六味丸」等合方/叠方残称，勿单独立空壳
  if (/合[\u4e00-\u9fff]{1,10}(?:汤|散|丸|饮|膏|丹)$/.test(n) || /益气六味|熟地两仪/.test(n)) {
    return false
  }
  if (/[请标校扫库维百目录序跋卷部提凡例]/.test(n) && n.length <= 4) return false
  if (/^(其|此|本|又|前|后|上|下|右|左|如|依|按|见|宜|用|愚|拟|制)方$/.test(n)) return false
  const stem = n.replace(/(?:汤|散|丸|膏|煎|饮|丹|方)$/, '')
  if (stem.length < 2 || stem.length > 6) return false
  // 词干不得再含剂型字或叙述虚词（「石膏」中的膏是药名，不视为剂型）
  if (/[汤散丸煎饮丹方]/.test(stem)) return false
  if (/膏/.test(stem.replace(/石膏/g, ''))) return false
  if (/[者而则也按愚用愈至分滓末酒同再滴淋证第服定亦予能烦躁聚问渴读尝善望初保肝日惟食形比缓论理节言不先并必脐谵乎之]/.test(stem)) {
    return false
  }
  if (/(?:引|欲|问|及|不化|不欲|有宜|俱弃|故欲|有形|平日|快食|药惟|慎言|下利|更汗|身必|名为|药乃|热里|脐腹|谵语|不可|必自|可更|先以|并脐|作有时|此以代|无血宜|曰中|然以|痛减|卧以|更以|针更|为小|捣汁|微火|速与|暂以)/.test(stem)) {
    return false
  }
  // 「五七十丸」「三十丸」等剂量，非方名
  if (/丸$/.test(n) && /^[空心加减]*[一二三四五六七八九十百千万余]+$/.test(stem)) return false
  if (/^[作此无曰然痛卧更针]/.test(n) && /以|宜|代|时/.test(stem)) return false
  if (/饮$/.test(n) && /[引欲问及烦躁赤日惟食药徐少开]/.test(stem)) return false
  if (/散$/.test(n) && /(?:不能|聚|表|消|望之|故欲|于理|揉|腹痛|益元|此二|为|发|解)/.test(stem)) return false
  if (/丹$/.test(n) && /(?:读朱|有望|疮疱|等)/.test(stem)) return false
  // 「服后大犀角汤」——「后」为继服指示
  if (/^后(?:大犀角|犀角麻黄)/.test(n)) return false
  if (/^[按愚为近以授审拙因至或宜世之如目夫众有比急缓制先并名药热干]/.test(n)) return false
  if (/^用/.test(n) && /此|本|一/.test(n)) return false
  // 「麻黄之汤」「乎尽散」「蜜为丸」「牛黄等丸」「荆芥以助石膏」「半月健饮」
  if (/之(?:汤|散|丸|膏|煎|饮|丹)$/.test(n)) return false
  if (/等(?:汤|散|丸)$/.test(n)) return false
  if (/蜜为丸|蜜煮|为丸$|为小丸$|半月健|以助|以泻|以补|以散|以消/.test(n)) return false
  if (/^亦可用|^可用/.test(n)) return false
  // 剂量/服法残片、治法栏目、叙述指令误作方名
  if (/两许|煮作茶|以热散|内药内散|堕治法|第\d+则|·方\d+$|静以待|治以加味|温宜散/.test(n)) {
    return false
  }
  if (/[·・]/.test(n)) return false
  if (/^[前后](?:三生|来复)/.test(n)) return false
  // 「宜温宜散」误截
  if (/^宜散$|^温宜散$|^宜温/.test(n)) return false
  // 「必宜凉如竹叶石膏汤」「治以白虎汤」类状语/引语伪名
  if (/^凉如|^宜凉|^必宜凉|^治以|^投以|^调以/.test(n)) return false
  // 「论吴又可达原饮不可以治温病」/「吴又可达原饮」冠称残片
  if (/^论/.test(n)) return false
  if (/^吴又可/.test(n)) return false
  return true
}

/**
 * 高精度抽取：仅「用/宜/服/与/名/曰 + 短方名」或「方名主之」。
 */
export function extractFormulaNames(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  // 去掉换行，避免「桂\n苓甘术汤主之」「白通\n加猪胆汁汤主之」截成伪名
  const cleaned = cleanWikiBody(text).replace(/\n+/g, '')

  // 宜用… 时只认「用」，避免「宜」吞掉「用桂枝汤」；方名放宽到 14 字以免截断「桂枝加龙骨牡蛎汤」
  const triggered =
    /(?:用|服|与|予|投|处|名|曰|宜(?!用))([\u4e00-\u9fff]{2,14}(?:汤|湯|散|丸|膏|煎|饮|飲|丹))(?=[。；，、：:\s主方治与及合加减]|$)/g
  let match: RegExpExecArray | null
  while ((match = triggered.exec(cleaned)) !== null) {
    const name = match[1]!
      .replace(/湯/g, '汤')
      .replace(/飲/g, '饮')
      .replace(/煎/g, '煎')
    if (!isPlausibleFormulaName(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  const mainZhi = /([\u4e00-\u9fff]{2,14}(?:汤|湯|散|丸|膏|煎|饮|飲|丹))(?:亦)?主之/g
  while ((match = mainZhi.exec(cleaned)) !== null) {
    const name = match[1]!.replace(/湯/g, '汤').replace(/飲/g, '饮')
    if (!isPlausibleFormulaName(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  return names
}

/** 极简药味切分：顿号/逗号分隔、「某某 钱/两」 */
export function roughParseHerbs(line: string): FormulaHerb[] {
  const simplified = toSimplifiedChinese(line)
  // 温病体例：连翘（一两） 银花（一两）
  if (/[（(][^）)]*[两钱分升合]/.test(simplified) && (simplified.match(/[（(]/g) || []).length >= 2) {
    const parsed = parseHerbLine(simplified.replace(/[＊*'"]/g, ' '))
    if (parsed.length >= 2) return parsed.slice(0, 16)
  }
  const chunks = simplified
    .split(/[、，,；;]/g)
    .map((item) => item.trim())
    .filter(Boolean)
  const herbs: FormulaHerb[] = []
  for (const chunk of chunks) {
    const m = chunk.match(/^([\u4e00-\u9fff]{1,8})\s*([一二三四五六七八九十两钱分升合勺枚枚只个].*)?$/)
    if (!m) continue
    const name = m[1]!
    if (/汤|散|丸|方|煎服|水煎/.test(name)) continue
    herbs.push({
      herbId: name,
      name,
      rawText: chunk,
      doseRaw: (m[2] ?? '').trim(),
    })
  }
  return herbs
}

export type WenbingFormulaBlock = {
  name: string
  herbs: FormulaHerb[]
  preparation: string
  /** 「即于某方内加…」派生 */
  baseName?: string
  removeNames?: string[]
}

const WENBING_FORMULA_ALIASES: Record<string, string> = {
  专翕膏: '专翕大生膏',
  专翕大生膏: '专翕大生膏',
  牛黄丸: '安宫牛黄丸',
  喻氏清燥救肺汤: '清燥救肺汤',
  故五苓散: '五苓散',
  故以加味清宫汤: '加味清宫汤',
}

function normalizeWenbingFormulaName(name: string): string {
  let n = name
    .replace(/['"*＊]/g, '')
    .replace(/方$/, '')
    .replace(/^(?:辛凉平剂|辛凉轻剂|辛凉重剂)/, '')
    .replace(/^(?:仲景|东垣|喻氏|故以|故|仿|曰)/, '')
    .trim()
  if (/[，,]/.test(n) && n.length > 16) {
    n = n.split(/[，,]/)[0]!.trim()
  }
  return WENBING_FORMULA_ALIASES[n] ?? n
}

/** 去掉「（咸寒甘润法）」类括注，便于识别即于/药列 */
export function stripWenbingMethodNote(herbLine: string): string {
  return herbLine
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/['"*＊]/g, '')
    .replace(/^[（(][^）)]{0,20}法[）)]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析「即于…去…加…」派生方 */
export function parseDerivedFormulaLine(herbLine: string): {
  baseName: string
  addHerbs: FormulaHerb[]
  removeNames: string[]
} | null {
  const line = stripWenbingMethodNote(herbLine).replace(/\s+/g, '')
  if (!/^(?:即于|即於|于前|即前)/.test(line)) return null
  if (/^(?:即于|即於)前方/.test(line)) return null

  const match = line.match(
    /^(?:即于|即於|即前)(?:前)?([\u4e00-\u9fff]{2,16}?)(?:汤|散|丸|膏|煎|饮)?方?(?:内|中)?[，,]?(?:去([\u4e00-\u9fff、，,]{1,40}?)[，,]?)?加(.+)$/,
  )
  if (!match) return null

  let baseName = normalizeWenbingFormulaName(match[1]!)
  if (!/(?:汤|散|丸|膏|煎|饮|丹)$/.test(baseName)) {
    // 「加减复脉」→「加减复脉汤」等：优先保留已带剂型；否则试加汤
    baseName = `${baseName}汤`
  }
  const removeNames = (match[2] ?? '')
    .split(/[、，,]/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 6)
  // 截断服法/加减后文，避免「阳留」「加人参二钱」等吞入
  let addRaw = match[3]!
  addRaw = (addRaw.split(/[。；]|煎如|脉虚|温服|分温|日再|不知|渣再|水[八五三]/)[0] ?? addRaw).trim()
  addRaw = addRaw.replace(/冲入.*$/, '')
  const addHerbs = cleanParenHerbs(parseHerbLine(addRaw).slice(0, 12))
  if (addHerbs.length === 0 && removeNames.length === 0) return null
  return { baseName, addHerbs, removeNames }
}

function clipHerbWindow(after: string): string {
  let window = after
  const nextFang = window.search(/【/)
  if (nextFang > 0) window = window.slice(0, nextFang)
  const nextHeading = window.search(/\n={2,}/)
  if (nextHeading > 0) window = window.slice(0, nextHeading)
  return (
    window.split(
      /上(?:杵|锉|㕮咀)|水[一二三四五六七八九十百]+杯|水[一二三四五六七八九十]+碗|甘澜水|甜水|熬膏|水煎|煎服|每服|方论|煮取|临时|和匀|不甚喜|重汤|日服|分数次|将成|[。；]\s*[一二三四五六七八九十]+[、．]|[。；]\s*按/,
    )[0] ?? window
  )
}

function parseDirectHerbLine(herbLine: string): FormulaHerb[] {
  let workLine = stripWenbingMethodNote(herbLine)
  if (!/[（(]/.test(workLine)) {
    const spacedOnly = workLine
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(
        (part) =>
          part.length >= 2 &&
          part.length <= 6 &&
          !/方|法|见前|加减|水煎|煮取|甘寒|辛凉|苦辛|酸甘|复方|偏于/.test(part),
      )
    if (spacedOnly.length >= 2) workLine = spacedOnly.join(' ')
  }
  let herbs = cleanParenHerbs(parseHerbLine(workLine).slice(0, 18))
  if (herbs.length < 2 && /\s/.test(workLine)) {
    const spaced = workLine
      .replace(/[（(][^）)]*[）)]/g, ' ')
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(
        (part) =>
          part.length >= 2 &&
          part.length <= 6 &&
          !/方|法|见前|加减|水煎|煮取|甘寒|辛凉|苦辛|酸甘|复方|偏于/.test(part),
      )
    herbs = cleanParenHerbs(
      spaced.slice(0, 16).map((herbName) => ({
        herbId: herbName,
        name: herbName,
        rawText: herbName,
        doseRaw: '',
      })),
    )
  }
  return herbs
}

function isSeeAlsoOnly(herbLine: string): boolean {
  return /^[（(]?(?:方并?见|见前|见上|见中|见下|俱见|并见)/.test(herbLine.trim())
}

function acceptHerbList(herbs: FormulaHerb[]): boolean {
  if (herbs.length === 0) return false
  const withDose = herbs.filter((h) => Boolean(h.doseRaw)).length
  // 单味方（一甲煎、牛乳饮、甘草汤）：剂量或括注（如牛乳（杯））
  if (herbs.length === 1) {
    const only = herbs[0]!
    return Boolean(only.doseRaw) || Boolean(only.note) || /[（(]/.test(only.rawText)
  }
  if (withDose < 1 && herbs.length < 3) return false
  return scoreFormulaHerbs(herbs) > 0
}

/**
 * 《温病条辨》式：【辛凉平剂银翘散方】 + 连翘（一两）银花（一两）… + 上杵为散
 * 兼收无【】的「方名（…法）药列」与「即于…加…」派生方。
 */
export function extractParenDoseFormulaBlocks(raw: string): WenbingFormulaBlock[] {
  const text = toSimplifiedChinese(cleanWikiBody(raw)).replace(/\r\n/g, '\n')
  const blocks: WenbingFormulaBlock[] = []
  const seen = new Set<string>()

  const pushBlock = (block: WenbingFormulaBlock) => {
    const key = `${block.name}::${block.baseName ?? ''}::${block.herbs.map((h) => h.name).join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    blocks.push(block)
  }

  const re = /【([^】]{2,60}?)】/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    let title = match[1]!.replace(/['"*＊]/g, '').trim()
    if (/^方论$/.test(title)) continue
    if (!/(?:汤|散|丸|膏|煎|饮|丹)方?$/.test(title) && !/方$/.test(title)) continue
    const name = normalizeWenbingFormulaName(title)
    if (name.length < 2 || name.length > 24) continue

    let after = text.slice(match.index + match[0].length, match.index + match[0].length + 500)
    after = clipHerbWindow(after)
    const herbLine = after
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/['"*＊]/g, ' ')
      .replace(/\n+/g, ' ')
      .trim()
    if (isSeeAlsoOnly(herbLine)) {
      // 「方见上焦篇」等：保留空壳，供 build 跨书同名供药（如玉女煎）
      pushBlock({ name, herbs: [], preparation: '' })
      continue
    }

    const derived = parseDerivedFormulaLine(herbLine)
    if (derived) {
      const prepMatch = after.match(/上(?:杵为散|锉|㕮咀)[^\n]{0,80}|水煎[^\n]{0,40}|每服[^\n]{0,40}/)
      pushBlock({
        name,
        herbs: derived.addHerbs,
        preparation: prepMatch?.[0] ?? '',
        baseName: derived.baseName,
        removeNames: derived.removeNames,
      })
      continue
    }

    const herbs = parseDirectHerbLine(herbLine)
    if (!acceptHerbList(herbs)) continue
    const prepMatch = after.match(/上(?:杵为散|锉|㕮咀)[^\n]{0,80}|水煎[^\n]{0,40}|每服[^\n]{0,40}/)
    pushBlock({ name, herbs, preparation: prepMatch?.[0] ?? '' })
  }

  // 无【】：「橘半桂苓枳姜汤（苦辛淡法）半夏（二两）…」「双补汤方（…）人参 山药…」
  const bareRe =
    /(?:^|[\n。；])([\u4e00-\u9fff]{2,16}(?:汤|散|丸|膏|煎|饮|丹))方?（[^）\n]{0,40}）\s*([\u4e00-\u9fffA-Za-z（）()、，,\s一二三四五六七八九十两钱分升合杯枚末汁]{3,220})/g
  while ((match = bareRe.exec(text)) !== null) {
    const name = normalizeWenbingFormulaName(match[1]!)
    if (name.length < 2 || name.length > 24) continue
    if (/^方论$/.test(name)) continue
    let after = match[2]!
    after = clipHerbWindow(after)
    if (isSeeAlsoOnly(after)) continue
    const herbs = parseDirectHerbLine(after.replace(/\n+/g, ' ').trim())
    if (!acceptHerbList(herbs)) continue
    pushBlock({ name, herbs, preparation: '' })
  }

  // 《温热经纬》散文：「用柴胡、…黄芩，名和血逐邪汤」「用苡仁…名止呃汤」
  const namedListRe =
    /(?:沈月光|陈远公(?:云|曰)?[∶:]?)?用([\u4e00-\u9fff、，,各一二三四五六七八九十两钱分厘两\s]{8,120})[，,]\s*名([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮|丹))/g
  while ((match = namedListRe.exec(text)) !== null) {
    const name = normalizeWenbingFormulaName(match[2]!)
    if (!isPlausibleFormulaName(name)) continue
    const herbRaw = match[1]!.replace(/各重用|等味|等分/g, ' ').trim()
    if (/宜用|雄按|汪按|杨云/.test(herbRaw)) continue
    const herbs = parseDirectHerbLine(herbRaw.replace(/、/g, ' '))
    if (herbs.length < 3) continue
    pushBlock({ name, herbs, preparation: '' })
  }

  // 《温热经纬》===集灵膏=== + 空格药列括注剂量
  const headingRe = /^(={2,4})\s*(.+?)\s*\1\s*$/gm
  const headingMarks: Array<{ name: string; index: number; end: number }> = []
  while ((match = headingRe.exec(text)) !== null) {
    const title = normalizeWenbingFormulaName(match[2]!.replace(/['"*＊]/g, '').trim())
    if (!/(?:汤|散|丸|膏|煎|饮|丹)$/.test(title)) continue
    if (title.length < 2 || title.length > 16) continue
    if (!isPlausibleFormulaName(title) && !/膏$/.test(title)) continue
    headingMarks.push({ name: title, index: match.index, end: match.index + match[0].length })
  }
  for (let hi = 0; hi < headingMarks.length; hi += 1) {
    const current = headingMarks[hi]!
    const next = headingMarks[hi + 1]
    let after = text.slice(current.end, next?.index ?? current.end + 400)
    after = clipHerbWindow(after)
    const herbLine = after
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/['"*＊]/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/雄按.*$/, '')
      .replace(/汪按.*$/, '')
      .trim()
    if (isSeeAlsoOnly(herbLine)) continue
    const herbs = parseDirectHerbLine(herbLine)
    if (!acceptHerbList(herbs)) continue
    const prepMatch = after.match(
      /(?:甜水|水)[^\n]{0,20}熬膏|[上右][^\n]{0,40}|白汤[^\n]{0,30}|水煎[^\n]{0,40}/,
    )
    pushBlock({ name: current.name, herbs, preparation: prepMatch?.[0] ?? '' })
  }

  // 六一散变体
  if (/滑石（六两/.test(text) && /甘草（一两/.test(text)) {
    const liuyi: FormulaHerb[] = [
      { herbId: '滑石', name: '滑石', rawText: '滑石（六两，水飞）', doseRaw: '六两' },
      { herbId: '甘草', name: '甘草', rawText: '甘草（一两，炙）', doseRaw: '一两', processing: '炙' },
    ]
    pushBlock({ name: '六一散', herbs: liuyi, preparation: '为细末' })
    const variants: Array<{ name: string; add: string }> = [
      { name: '益元散', add: '辰砂' },
      { name: '红玉散', add: '黄丹' },
      { name: '碧玉散', add: '青黛' },
      { name: '鸡苏散', add: '薄荷' },
    ]
    for (const variant of variants) {
      if (!text.includes(`名${variant.name}`) && !text.includes(variant.name)) continue
      pushBlock({
        name: variant.name,
        herbs: [{ herbId: variant.add, name: variant.add, rawText: variant.add, doseRaw: '少许' }],
        preparation: '',
        baseName: '六一散',
      })
    }
  }

  // 金花汤系：去大黄加黄柏 → 金花汤；更加栀子 → 栀子金花汤；加大黄 → 大金花汤
  if (/名金花\s*汤|名金花汤/.test(text) && /黄连/.test(text) && /黄芩/.test(text)) {
    const jinhua: FormulaHerb[] = [
      { herbId: '黄连', name: '黄连', rawText: '黄连', doseRaw: '' },
      { herbId: '黄芩', name: '黄芩', rawText: '黄芩', doseRaw: '' },
      { herbId: '黄柏', name: '黄柏', rawText: '黄柏', doseRaw: '' },
    ]
    pushBlock({ name: '金花汤', herbs: jinhua, preparation: '' })
    pushBlock({ name: '金花丸', herbs: jinhua.map((h) => ({ ...h })), preparation: '蜜丸' })
    pushBlock({ name: '三补金花丸', herbs: jinhua.map((h) => ({ ...h })), preparation: '蜜丸' })
    pushBlock({
      name: '大金花汤',
      herbs: [
        ...jinhua,
        { herbId: '大黄', name: '大黄', rawText: '大黄', doseRaw: '' },
      ],
      preparation: '',
    })
  }

  // 桂（一两）茯苓（二两）…作汤名桂苓饮
  const guiling = text.match(
    /桂（一两）\s*茯苓（二两）[\s\S]{0,60}?作汤名桂苓饮/,
  )
  if (guiling) {
    pushBlock({
      name: '桂苓饮',
      herbs: [
        { herbId: '桂枝', name: '桂枝', rawText: '桂（一两）', doseRaw: '一两' },
        { herbId: '茯苓', name: '茯苓', rawText: '茯苓（二两）', doseRaw: '二两' },
      ],
      preparation: '作汤',
    })
  }

  return blocks
}

function scoreFormulaHerbs(herbs: FormulaHerb[]): number {
  if (herbs.length === 0) return -1
  let score = Math.min(herbs.length, 16)
  score += herbs.filter((h) => Boolean(h.doseRaw)).length * 3
  const junk = herbs.filter((h) => !isPlausibleParenHerbName(h.name)).length
  score -= junk * 6
  if (junk > 0 && junk >= herbs.length / 2) return -1
  return score
}

function isPlausibleParenHerbName(name: string): boolean {
  const cleaned = name.replace(/=+/g, '').trim()
  if (!cleaned || cleaned.length > 5 || cleaned.length < 2) return false
  if (/法$/.test(cleaned)) return false
  if (
    /者$|煮取|煎法|服法|方论|加减|即于|渣再|夜一|日[二三]|不知|再作|共为|他变|不除|不解|似喘|病退|减后|暮热|舌绛|气粗|澄清|定获|奇效|临时|和匀|太阴|阳明|寸脉|心烦|起卧|欲呕|中焦|温病|得之|风温|温热|温疫|温毒|冬温|面赤|或已下|甚则|仍可|气血|暑温|湿温|燥证|阳留|偏于|茶匙|冲入|甘寒|辛凉|苦辛|酸甘|咸寒|甘润/.test(
      cleaned,
    )
  ) {
    return false
  }
  if (
    /^[水日三气舌暮反病加勿脉十=而]/.test(cleaned) &&
    !/^(?:水蛭|水牛角|牡丹|知母|石膏|甘草|竹叶)/.test(cleaned)
  ) {
    return false
  }
  if (/风温|温热|温疫|温毒|冬温|面赤|阳留/.test(cleaned)) return false
  if (/杯$|钟$|服$|病$/.test(cleaned)) return false
  if (/^[一二三四五六七八九十百]+$/.test(cleaned)) return false
  return true
}

function cleanParenHerbs(herbs: FormulaHerb[]): FormulaHerb[] {
  return herbs.filter((h) => isPlausibleParenHerbName(h.name.replace(/=+/g, '')))
}

function herbMatchesRemove(herbName: string, removeName: string): boolean {
  if (!removeName) return false
  if (herbName === removeName) return true
  const herbStem = herbName.replace(/^生|^炙|^干|^炒|^焦/, '')
  const removeStem = removeName.replace(/^生|^炙|^干|^炒|^焦/, '')
  return (
    herbStem === removeStem ||
    herbName.endsWith(removeName) ||
    removeName.endsWith(herbStem) ||
    herbStem.endsWith(removeStem)
  )
}

function applyDerivedHerbs(
  baseHerbs: FormulaHerb[],
  addHerbs: FormulaHerb[],
  removeNames: string[] = [],
): FormulaHerb[] {
  const kept = baseHerbs.filter(
    (herb) => !removeNames.some((removeName) => herbMatchesRemove(herb.name, removeName)),
  )
  const existing = new Set(kept.map((h) => h.name))
  const merged = [...kept]
  for (const herb of addHerbs) {
    if (existing.has(herb.name)) continue
    existing.add(herb.name)
    merged.push({ ...herb })
  }
  return cleanParenHerbs(merged)
}

function ensureFormulaSlot(
  formulas: Formula[],
  byName: Map<string, Formula>,
  bookId: BookId,
  name: string,
): Formula {
  const existing = byName.get(name)
  if (existing) return existing
  const formula: Formula = {
    id: `${bookId}-formula-${name}`,
    name,
    book: bookId,
    herbs: [],
    preparation: '',
    modifications: [],
    sourceClauseIds: [],
    doseSystem: 'qing',
  }
  formulas.push(formula)
  byName.set(name, formula)
  return formula
}

/** 把括注剂量方块并入已有 formulas（干净有剂量的块优先覆盖脏粗抽） */
export function mergeParenDoseFormulas(
  formulas: Formula[],
  blocks: WenbingFormulaBlock[],
  bookId: BookId,
): Formula[] {
  const byName = new Map(formulas.map((f) => [f.name, f]))
  // 别名空壳指向正名
  for (const formula of formulas) {
    const canonical = normalizeWenbingFormulaName(formula.name)
    if (canonical !== formula.name && !byName.has(canonical)) {
      byName.set(canonical, formula)
    }
  }

  const derived: WenbingFormulaBlock[] = []
  for (const block of blocks) {
    const name = normalizeWenbingFormulaName(block.name)
    if (block.baseName) {
      derived.push({ ...block, name })
      continue
    }
    const herbs = cleanParenHerbs(block.herbs)
    // 见前空壳：占名，待跨书 donor / 同书别名回填
    if (herbs.length === 0) {
      ensureFormulaSlot(formulas, byName, bookId, name)
      continue
    }
    if (!acceptHerbList(herbs)) continue
    const existing = ensureFormulaSlot(formulas, byName, bookId, name)
    if (scoreFormulaHerbs(herbs) > scoreFormulaHerbs(existing.herbs)) {
      existing.herbs = herbs.map((h) => ({ ...h }))
      existing.preparation = block.preparation || existing.preparation
    }
  }

  // 派生方可能依赖另一派生方（二甲→三甲），多轮回填
  for (let pass = 0; pass < 6; pass += 1) {
    let progressed = false
    for (const block of derived) {
      const baseName = normalizeWenbingFormulaName(block.baseName ?? '')
      const base =
        byName.get(baseName) ??
        byName.get(baseName.replace(/汤$/, '')) ??
        byName.get(`${baseName}汤`)
      if (!base || scoreFormulaHerbs(base.herbs) <= 0) continue
      const herbs = applyDerivedHerbs(base.herbs, block.herbs, block.removeNames ?? [])
      if (!acceptHerbList(herbs) && herbs.length < 2) continue
      const existing = ensureFormulaSlot(formulas, byName, bookId, block.name)
      if (scoreFormulaHerbs(herbs) > scoreFormulaHerbs(existing.herbs)) {
        existing.herbs = herbs.map((h) => ({ ...h }))
        existing.preparation = block.preparation || existing.preparation
        progressed = true
      }
    }
    if (!progressed) break
  }

  // 前缀/别名空壳若正名已有药，拷贝过去
  for (const formula of formulas) {
    if (scoreFormulaHerbs(formula.herbs) > 0) continue
    const stripped = normalizeWenbingFormulaName(formula.name)
    if (stripped === formula.name) continue
    const donor = byName.get(stripped)
    if (donor && scoreFormulaHerbs(donor.herbs) > 0) {
      formula.herbs = donor.herbs.map((h) => ({ ...h }))
      formula.preparation = formula.preparation || donor.preparation
    }
  }
  return formulas
}

/** 方块条文挂到同名 formula 的 sourceClauseIds，并回写 clause.formulaIds */
export function attachFormulaBlocksToClauses(clauses: Clause[], formulas: Formula[]): void {
  const byName = new Map(formulas.map((f) => [f.name, f]))
  for (const formula of formulas) {
    const alias = normalizeWenbingFormulaName(formula.name)
    if (!byName.has(alias)) byName.set(alias, formula)
  }
  for (const clause of clauses) {
    for (const [name, formula] of byName) {
      if (name.length < 2) continue
      const hit =
        clause.text.includes(`【${name}`) ||
        clause.text.includes(`【${name}方`) ||
        clause.text.includes(`${name}（`) ||
        clause.text.includes(`${name}方（`)
      if (!hit) continue
      if (!formula.sourceClauseIds.includes(clause.id)) {
        formula.sourceClauseIds.push(clause.id)
      }
      if (!clause.formulaIds.includes(formula.id)) {
        clause.formulaIds.push(formula.id)
      }
    }
  }
}

/**
 * 在方名附近抽取药味：优先「方名…：药1、药2」或「方名 药1 药2 右㕮咀/水煎」。
 */
export function roughParseHerbsNearFormula(clauseText: string, formulaName: string): FormulaHerb[] {
  const text = toSimplifiedChinese(cleanWikiBody(clauseText))
  const idx = text.indexOf(formulaName)
  if (idx < 0) return []
  let window = text.slice(idx, idx + formulaName.length + 220)
  // 勿跨到下一【方】块
  const nextBlock = window.search(/【/)
  if (nextBlock > formulaName.length) window = window.slice(0, nextBlock)
  // 温病：方名后紧跟「药（两）药（钱）」
  const parenChunk = window.match(
    /([\u4e00-\u9fff]{1,8}[（(][^）)]{1,12}[）)](?:\s*[\u4e00-\u9fff]{1,8}[（(][^）)]{1,12}[）)]){1,14})/,
  )
  if (parenChunk?.[1]) {
    const herbs = parseHerbLine(parenChunk[1])
    if (herbs.length >= 2) return herbs.slice(0, 16)
  }
  // 「桂枝汤：桂枝、芍药、甘草」或紧随其后的顿号列表
  const listMatch = window.match(
    new RegExp(
      `${formulaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^。]{0,8}[：:，,]?\\s*([\\u4e00-\\u9fff、，,\\s一二三四五六七八九十两钱分升合勺各]{4,80})`,
    ),
  )
  if (listMatch?.[1]) {
    const herbs = roughParseHerbs(listMatch[1])
    if (herbs.length >= 2) return herbs.slice(0, 12)
  }
  // 「右㕮咀 / 水煎服」前的空格分隔药名
  const prepMatch = window.match(
    /([\u4e00-\u9fff]{1,6}(?:\s+[\u4e00-\u9fff]{1,6}){1,10})\s*(?:右|㕮咀|水煎|煎服)/,
  )
  if (prepMatch?.[1]) {
    const parts = prepMatch[1]
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 1 && p.length <= 6 && !/汤|散|丸|方|饮/.test(p))
    if (parts.length >= 2) {
      return parts.slice(0, 12).map((name) => ({
        herbId: name,
        name,
        rawText: name,
        doseRaw: '',
      }))
    }
  }
  // 临证指南体例：方名后紧跟空格分隔药列（无人参 归身 鹿茸 …）
  const afterName = window.slice(formulaName.length).replace(/^[。．；：:\s法]+/, '')
  const spaced = afterName.match(
    /^([\u4e00-\u9fff]{1,6}(?:\s+[\u4e00-\u9fff]{1,6}){2,12})/,
  )
  if (spaced?.[1]) {
    const parts = spaced[1]
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(
        (p) =>
          p.length >= 1 &&
          p.length <= 6 &&
          !/汤|散|丸|方|饮|煎|又|照前|接服/.test(p),
      )
    if (parts.length >= 3) {
      return parts.slice(0, 12).map((herbName) => ({
        herbId: herbName,
        name: herbName,
        rawText: herbName,
        doseRaw: '',
      }))
    }
  }
  return []
}

export function buildClausesFromSections(options: {
  bookId: BookId
  sections: WikiSection[]
  /** 是否把 section 再切成段落条文；默认 true */
  splitIntoParagraphs?: boolean
}): { clauses: Clause[]; formulas: Formula[] } {
  const { bookId, sections } = options
  const splitIntoParagraphs = options.splitIntoParagraphs !== false
  const clauses: Clause[] = []
  const formulas: Formula[] = []
  const formulaByKey = new Map<string, Formula>()

  let chapterOrder = 0
  for (const section of sections) {
    chapterOrder += 1
    const units = splitIntoParagraphs
      ? splitParagraphs(section.body)
      : [section.body.replace(/\n+/g, '').trim()].filter(Boolean)

    let order = 0
    for (const unit of units) {
      order += 1
      const clauseId = `${bookId}-${String(chapterOrder).padStart(3, '0')}-${String(order).padStart(4, '0')}`
      const names = extractFormulaNames(unit)
      const formulaIds: string[] = []
      for (const [index, name] of names.entries()) {
        const id = `${bookId}-formula-${name}`
        formulaIds.push(id)
        const existing = formulaByKey.get(id)
        if (existing) {
          if (!existing.sourceClauseIds.includes(clauseId)) {
            existing.sourceClauseIds.push(clauseId)
          }
          continue
        }
        const herbs = roughParseHerbsNearFormula(unit, name)
        const formula: Formula = {
          id,
          name,
          book: bookId,
          herbs,
          preparation: '',
          modifications: [],
          sourceClauseIds: [clauseId],
          chapter: section.title,
          doseSystem: 'qing',
          role: index === 0 ? 'main' : 'alternate',
        }
        formulaByKey.set(id, formula)
        formulas.push(formula)
      }

      const clauseText = cleanWikiBody(unit).replace(/\n+/g, '').trim().slice(0, 4000)
      if (clauseText.length < 12) continue

      clauses.push({
        id: clauseId,
        book: bookId,
        chapter: section.title,
        chapterOrder,
        order,
        text: clauseText,
        formulaIds,
        symptomTags: [],
        pulseTags: [],
        channelTags: [],
        pathogenesisTags: [],
        heading: section.level >= 3 ? section.title : undefined,
        reviewStatus: 'ai-draft',
      })
    }
  }

  return { clauses, formulas }
}

import assert from 'node:assert/strict'
import type { BookId, Clause, Formula, FormulaHerb } from '../../src/types/data.ts'
import { cleanWikiBody, listWikiHeadings, splitHeadingUnits } from './generic-wiki-parse.ts'
import { extractFormulaBlocks, parseHerbLine } from './formula-parse.ts'
import { isSpuriousHerbName } from './herbs.ts'
import { toSimplifiedChinese } from './wiki.ts'

const FANGLUN_SPURIOUS_HERB_RE =
  /分两|随人|随证|须上|若内|难化|服此|不损|已损|春夏|秋冬|先用|探之|立下|横生|倒生|交骨|产后|崩中|金疮|虚热|饮食|作酸|炮姜|上生|须加|须用|浓煎|顿服|拣者|风热壅盛|炼蜜|为末|上为|另研|蒸饼|为衣|去白|米泔|酒调|熟水|桐子|去核|钱半|自然汁|新汲|血者|自败|甘州|如法|空心|灌之|即醒|酒泡|又方|方寸|治下筛|日三服|日三|酒服|导引|方见前|两头尖|去角|分再服|再服|稍稍服|稍加|汗出|煮三沸|去滓|汤成|铜器|微火煎|不堪|日预服|蜜和丸|丸如|梧子|弹子|饮下|汤下|酒下|日四|日五|为度|合煮|一云|外台秘要|范汪疗|广济疗|三合汗|微熬研|去皮尖|双仁|两仁|右药|捣散|一方用|四首|三首|瘅|宿勿食|且服|熬去尖|黄焦土|毒公|辟鬼|必効|必效/
const FANGLUN_SPURIOUS_EXACT = new Set([
  '姜汁',
  '麻子',
  '去角',
  '好豉',
  '汗出',
  '一升',
  '煮三沸',
  '稍稍服',
  '分再服',
  '分再',
  '更服',
  '平旦服',
  '强人服',
  '汤成去滓',
  '陈者',
  '烂者',
  '中者',
  '强者',
])
const SINGLE_CHAR_HERB_ALLOW = new Set(['艾', '蜡', '酥', '蜜', '豉', '胶', '椒', '枣', '葱', '姜', '矾'])
const GLUE_HERB_NAMES = [
  '栀子仁',
  '射干',
  '苦参',
  '防风',
  '川芎',
  '当归',
  '白术',
  '茯苓',
  '桂枝',
  '桂心',
  '人参',
  '黄芪',
  '黄耆',
  '甘草',
  '白芍',
  '芍药',
  '干姜',
  '生姜',
  '大黄',
  '黄芩',
  '黄连',
  '半夏',
  '陈皮',
  '厚朴',
  '枳实',
  '柴胡',
  '独活',
  '羌活',
  '桔梗',
  '泽泻',
  '猪苓',
  '白薇',
  '漏芦',
  '连翘',
  '芒硝',
  '细辛',
  '干葛',
  '牙子',
  '芜荑',
  '香豉',
  '栀子',
  '麻黄',
  '黄檗',
  '黄柏',
  '杏仁',
  '蜀椒',
  '升麻',
  '白芷',
  '防己',
  '通草',
  '滑石',
  '石膏',
  '知母',
  '粳米',
  '附子',
  '紫菀',
  '茯神',
  '龙胆',
  '常山',
  '鳖甲',
  '犀角',
  '漏芦',
  '石南',
].sort((a, b) => b.length - a.length)

/** 贪心切开「升麻桂心」「栀子仁黄芩」「苦参升麻」等粘连药对 */
function splitGluedHerbName(name: string): string[] | null {
  if (name.length < 4) return null
  const parts: string[] = []
  let rest = name
  while (rest.length > 0) {
    const hit = GLUE_HERB_NAMES.find((herb) => rest.startsWith(herb))
    if (!hit) return null
    parts.push(hit)
    rest = rest.slice(hit.length)
  }
  return parts.length >= 2 ? parts : null
}

function cleanFanglunHerbLine(line: string): string {
  return line
    .replace(/[（(]([^）)]*)[）)]/g, (_all, inner: string) => {
      const text = String(inner)
      // 保留真剂量括注：一钱、二两、各三钱
      if (/[一二三四五六七八九十百]+[两钱分升合勺枚]/.test(text) || /^各/.test(text)) {
        return `（${text}）`
      }
      // 短炮制保留；长加工说明丢弃（米泔浸七日、去白…）
      if (/^(?:制|炒|炙|酒炒|酒浸|盐炒|煨|生|熟)$/.test(text)) return `（${text}）`
      return ' '
    })
    .replace(/须上拣者[^，。\s]*/g, ' ')
    .replace(/分两随人[^，。\s]*/g, ' ')
    .replace(/若[^，。]{2,20}须加/g, '加')
}

function looksLikeIndicationProse(line: string): boolean {
  if (/[（(]/.test(line) && /[两钱分升合枚各铢株]/.test(line)) return false
  const parts = line.split(/[、，,\s]+/).filter(Boolean)
  const shortHerbLike = parts.filter((part) => part.length <= 4 && /^[\u4e00-\u9fff]+$/.test(part))
  // 证候关键词优先：即使短片段多，仍是适应症散文
  if (
    /发热|六七日|不解|脉浮|咽燥|口苦|腹满|恶热|烦躁|愦愦|怵惕|懊|恶风|恶寒|消渴|小便|表里|汗出|不恶寒|反恶热|身重|目疼|鼻干|不得卧|饥而不|吐蛔|其人|渴欲饮|水入则|中风发热|补血益气|不热不冷|温而调之|神妙难述|饥能使|能使饥|遂漏不止|四肢微急|难以屈伸/.test(
      line,
    ) &&
    !/[（(]/.test(line)
  ) {
    return true
  }
  // 「羌活、防风、川芎…」无剂量的纯药列，不当作证候散文
  if (parts.length >= 3 && shortHerbLike.length / parts.length >= 0.6) return false
  if (
    /时值|方退|精神恍惚|调理俱宜|亦宜服|大补精髓|益气养神|又名|一名|风湿相搏|身体烦疼|长夏湿热|已成鼓证|其效如神|湿成痹|肺经壅塞|昏乱不语|冷风哮吼|最宜|分再服|相去如|不堪更服|冬日着火|行步动作|产余病|宜服黄土|然后可煮|明旦去滓|咳逆烦满|或忧劳|白疹瘙|并治诸气|恶风不欲|常服明目/.test(
      line,
    )
  ) {
    return true
  }
  if (/者$/.test(line) && line.length > 10 && !/[（(]/.test(line) && shortHerbLike.length < 3) {
    return true
  }
  // 服法碎片：无剂量括注且含煎服用语
  if (
    !/[（(]/.test(line) &&
    /(?:分再服|温服|顿服|去滓|煮取|煎取|日三|日再|稍加|不知|以知为度|空心|先食|后食|水[一二三四五六七八九十半]+盏|煎[一二三四五六七八九十半]+盏)/.test(
      line,
    ) &&
    shortHerbLike.length < 2
  ) {
    return true
  }
  return false
}

function filterFanglunHerbs(herbs: FormulaHerb[]): FormulaHerb[] {
  const merged: FormulaHerb[] = []
  for (let i = 0; i < herbs.length; i += 1) {
    let herb = herbs[i]!
    // 「黄」在补血语境常为黄耆截断
    if (herb.name === '黄') herb = { ...herb, name: '黄芪', herbId: '黄芪' }
    if (herb.name === '黄耆') herb = { ...herb, name: '黄芪', herbId: '黄芪' }
    if (herb.name === '云术') herb = { ...herb, name: '白术', herbId: '白术' }
    if (herb.name === '大附子') herb = { ...herb, name: '附子', herbId: '附子' }
    if (herb.name === '薄菏') herb = { ...herb, name: '薄荷', herbId: '薄荷' }
    if (herb.name === '夏石膏' || herb.name === '半夏石膏') {
      merged.push({ ...herb, name: '半夏', herbId: '半夏' })
      herb = { ...herb, name: '石膏', herbId: '石膏' }
    }
    // 「桔」「梗」被空格拆开
    if (herb.name === '桔' && herbs[i + 1]?.name === '梗') {
      herb = { ...herb, name: '桔梗', herbId: '桔梗' }
      i += 1
    }
    if (!herb.name || herb.name.length > 5) continue
    // 方名/卷名/服法残片误入
    if (/方$|首$|卷$|汤$|散$|丸$/.test(herb.name)) continue
    if (/^右|^一方|^擘|^去皮|^熬去/.test(herb.name)) continue
    if (herb.name.length === 1 && !SINGLE_CHAR_HERB_ALLOW.has(herb.name)) continue
    if (
      herb.name === '制' ||
      herb.name === '酒炒' ||
      herb.name === '炒' ||
      herb.name === '炼' ||
      herb.name === '酒浸' ||
      herb.name === '面裹煨'
    )
      continue
    if (/^加/.test(herb.name)) continue
    // 剂量数字误入药名
    if (/^[一二三四五六七八九十百千万半]+$/.test(herb.name)) continue
    if (/^[一二三四五六七八九十百]+[两钱分升合斤枚]$/.test(herb.name)) continue
    if (isSpuriousHerbName(herb.name)) continue
    if (FANGLUN_SPURIOUS_EXACT.has(herb.name)) continue
    if (FANGLUN_SPURIOUS_HERB_RE.test(herb.name)) continue
    if (/^[若须服先上春秋及诸夫]/.test(herb.name)) continue
    // 证候/服法碎片：「…者」「分再服」「汗出」等
    if (/者$/.test(herb.name) && herb.name.length >= 2) continue
    if (
      /则|等证|过多|又夫|合一|壅盛|便秘|发斑|惊急|黑陷|病痊|尽剂|药力|即此|加味|稀粥|不必|煨姜|滤过|细末|砂锅|桑柴|蜡封|悬井|汤调|酒化|冲温|调末|痰涎|有汗|汗出|水飞|酒蒸|忌火|焰消|埋地|五盅|去枣|不调|频数|食不消|恶寒|不乐|面色|困倦|烦渴|欲饮|不利|水肿|自汗|不可|湿热|方退|体重|口干|肺病|鼓证|如神|恍惚|语言|身不遂|麻木|筋骨|少力|微掣|跳动|调治|风病|元气|俱热|无气|积聚|水蓄|后重|精神|烦心|脉虚|将参|和匀|取出|扎口|取起|半日|之内|服之|以上|调服|合均|瓷罐|渗去|对证|万元|醋炒|轻粉|渐加|不支|俱可|隔一|疮疡|止痛|皂角制|之证|或渴|或利|或噎|或小便|太阳|如疟|寒少|不呕|自可|脉微|阴阳|黄半|时速|背痛|湿成|壅塞|昏乱|哮吼|最宜|钦定|四库|子部|分再服|分再|再服|更服|稍服|稍加|合煮|一云|为度|煮三|去滓|汤成|铜器|微火|不堪|预服|蜜和|丸如|饮下|日四|日五|外台|范汪|广济|秘要|熬研|笼之|冷浆|叩巾|下水谷|悬蹄|一撮|马屎|镜鼻|何公|如上法|清酒|梨叶|度饮|瘙已|明目|去衣|绢袋|黄色|得数|发动|乳汁|向心|夭矫|浓煮|桂汁|桂枝证|明日更|每日只|平旦|遂急合|旦空腹|五服愈|强人服/.test(
        herb.name,
      )
    )
      continue
    // 「防风川芎」「栀子仁黄芩」「苦参升麻」「升麻桂心」类粘连
    if (herb.name.length >= 4) {
      const parts = splitGluedHerbName(herb.name)
      if (parts && parts.length >= 2) {
        for (const part of parts.slice(0, -1)) {
          merged.push({ ...herb, name: part, herbId: part })
        }
        herb = { ...herb, name: parts[parts.length - 1]!, herbId: parts[parts.length - 1]! }
      }
    }
    if (herb.name.length >= 4 && /[，。；、]/.test(herb.name)) continue
    merged.push(herb)
  }
  return merged
}

export interface FangshuParseResult {
  clauses: Clause[]
  formulas: Formula[]
  stats: {
    chapterCount: number
    clauseCount: number
    formulaCount: number
    withHerbs: number
  }
}

function normalizeFormulaName(raw: string): string {
  return toSimplifiedChinese(raw)
    .replace(/湯/g, '汤')
    .replace(/飲/g, '饮')
    .replace(/[【】\[\]]/g, '')
    .replace(/方$/, '')
    .trim()
}

const FANGLUN_SUFFIX_RE = /(?:汤|散|丸|膏|煎|饮|丹|酒|胶|醴|汤方|汤丸|汤并丸)$/
const FANGLUN_NAME_ALIAS: Record<string, string> = {
  琼玉青: '琼玉膏',
  竹叶黄汤: '竹叶黄芪汤',
  三黄石青汤: '三黄石膏汤',
  小青龙加石青汤: '小青龙加石膏汤',
  枝枝人参汤: '桂枝人参汤',
  谓胃承气汤: '调胃承气汤',
  桂枝汤去芍药加茯苓白术汤: '桂枝去芍药加茯苓白术汤',
  桂枝去芍药加茯苓白术汤方: '桂枝去芍药加茯苓白术汤',
  桂枝加芍药汤方: '桂枝加芍药汤',
  桂枝加大黄汤方: '桂枝加大黄汤',
  大陷胸汤丸: '大陷胸汤',
  抵当汤并丸: '抵当汤',
  理中汤丸: '理中汤',
  越鞠汤丸: '越鞠丸',
  三物白散方: '三物白散',
  苓甘术汤: '桂苓甘术汤',
  加猪胆汁汤: '白通加猪胆汁汤',
}

/** 服法残片 / 叙述截断，不得立为方论块 */
const FANGLUN_SPURIOUS_NAME_RE =
  /^(?:三物水煎|枣肉为小丸|开骨散|铜器微火煎|麻子大一丸|芥子七丸|枣大二丸|马齿菜捣汁煎|速与续命汤)$|捣汁煎$|微火煎$|为小丸$|合(?:汤|散|丸)$/

function isSpuriousFangshuName(name: string): boolean {
  return FANGLUN_SPURIOUS_NAME_RE.test(name)
}

/** Wikisource 残标 `\x方名\x` → 【方名】，便于与【】块统一切段 */
function normalizeFanglunMarkers(raw: string): string {
  return raw.replace(/\\x([\u4e00-\u9fffA-Za-z0-9　\s]{2,30})\\x/g, (_all, name: string) => {
    const compact = String(name).replace(/\s+/g, '').trim()
    return compact ? `【${compact}】` : _all
  })
}

/** 行首煎服 / 从行中切开「水煎服」等，前段留药味 */
function splitHerbAndPrep(line: string): { herbPart: string; prepPart: string } {
  const trimmed = line.replace(/^[:：]\s*/, '').trim()
  if (/^(?:上|右)[一二三四五六七八九十百]?味|^㕮咀|^为细末|^上(?:锉|㕮咀)/.test(trimmed)) {
    return { herbPart: '', prepPart: trimmed }
  }
  const inline = trimmed.search(
    /\s*(?:水煎服|水煎|煎服|蜜丸|温服|每服|浓煎|顿服|加姜|加枣)/,
  )
  if (inline > 0) {
    return {
      herbPart: trimmed.slice(0, inline).trim(),
      prepPart: trimmed.slice(inline).trim(),
    }
  }
  if (inline === 0) return { herbPart: '', prepPart: trimmed }
  return { herbPart: trimmed, prepPart: '' }
}

function stripZhiIndication(line: string): string {
  if (!/^治/.test(line)) return line
  // 「治…。」后接药味，或同行有括注剂量
  const afterPeriod = line.match(/^治[^。]{2,120}。[　\s]*(.+)$/)
  if (afterPeriod?.[1]) return afterPeriod[1].trim()
  const doseStart = line.search(/[\u4e00-\u9fff]{2,8}\s*[（(]/)
  if (doseStart > 0) return line.slice(doseStart).trim()
  return ''
}

/** 方论块常把「治…」跨行写完再列药；整段剥适应症到句号为止 */
function stripLeadingZhiBlock(composition: string): string {
  let trimmed = composition.trim()
  // 「又名通关丸」「一名冲和汤」开场；勿吞掉后续「治…」
  trimmed = trimmed.replace(
    /^(?:又名|一名)[\u4e00-\u9fff]{1,12}(?:汤|散|丸|饮|膏|丹|胶)?[，、。]?\s*/,
    '',
  )
  // 「（附∶茵陈五苓散）」挡在「治」前，先剥掉
  trimmed = trimmed.replace(/^（附[：∶][^）]{0,40}）\s*/, '')
  trimmed = trimmed.replace(/^\(附[：:][^)]{0,40}\)\s*/, '')

  // 优先：切到首条带剂量括注的药行（金鉴标准体例）
  const doseLine = trimmed.search(/(?:^|\n)[^\n]*[（(][^）)]*[两钱分升合枚铢株]/)
  if (doseLine >= 0) {
    const before = trimmed.slice(0, doseLine)
    if (
      /^治/.test(trimmed) ||
      /治|发热|脉浮|咽燥|恶寒|恶风|消渴|小便|六七日|不解|表里|其人/.test(before) ||
      looksLikeIndicationProse((before.split(/\n/).filter(Boolean).pop() || '').trim())
    ) {
      const from = trimmed[doseLine] === '\n' ? doseLine + 1 : doseLine
      return trimmed.slice(from).trim()
    }
  }

  // 连续剥「治…。」
  while (/^治/.test(trimmed)) {
    const end = trimmed.search(/。/)
    if (end < 0) break
    trimmed = trimmed.slice(end + 1).trim()
  }
  // 残余「…者。」证候句
  while (true) {
    const m = trimmed.match(/^[^。\n]{2,100}者。[　\s]*/)
    if (!m || /[（(]/.test(m[0])) break
    if (!/治|发热|脉浮|渴|不利|中风|汗|表|里|烦|吐/.test(m[0])) break
    trimmed = trimmed.slice(m[0].length).trim()
  }

  if (!/^治/.test(trimmed)) {
    if (looksLikeIndicationProse(trimmed.split(/\n/)[0] || '')) {
      const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean)
      const start = lines.findIndex((line) => !looksLikeIndicationProse(line))
      if (start > 0) return lines.slice(start).join('\n')
    }
    return trimmed
  }
  // 「治…者，药1、药2」无句号
  const zhe = trimmed.match(/^治.+?者[，,、]\s*(.+)$/s)
  if (zhe?.[1]) return zhe[1].trim()
  return trimmed
}

/** 截掉「加味××」「引用…」等变方/服法附注，避免灌入药味 */
function trimFanglunCompositionTail(composition: string): string {
  const cut = composition.search(
    /\n\s*(?:加味|引用|一方|一方加|上[一二三四五六七八九十百]?味|右[一二三四五六七八九十百]?味)/,
  )
  if (cut > 0) return composition.slice(0, cut).trim()
  return composition.trim()
}

/** 半夏 / 黄芪 等常被断行：末字单字接到下一行 */
function joinBrokenHerbLines(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    if (
      prev &&
      !/[。；！？]$/.test(prev) &&
      /^[\u4e00-\u9fff]/.test(line) &&
      !/^(?:上|右|治|每|加味|引用|水煎|煎服)/.test(line)
    ) {
      const lastToken = prev.split(/\s+/).pop() || ''
      if (lastToken.length <= 1 || /^(?:半|黄|生|熟|制|炒|炙|粉|石)$/.test(lastToken)) {
        out[out.length - 1] = `${prev}${line}`
        continue
      }
    }
    out.push(line)
  }
  return out
}

/** 《删补名医方论》【方名】块（含 Wikisource `\x方名\x` 残标） */
export function extractFanglunBlocks(raw: string): Array<{
  name: string
  body: string
  herbs: FormulaHerb[]
  preparation: string
}> {
  const text = toSimplifiedChinese(normalizeFanglunMarkers(cleanWikiBody(raw))).replace(/\r\n/g, '\n')
  const blocks: Array<{ name: string; body: string; herbs: FormulaHerb[]; preparation: string }> = []
  const re = /【([^】]{2,40})】/g
  const marks: Array<{ name: string; index: number; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    let name = normalizeFormulaName(match[1]!)
    if (/^(?:注|集注|按|方解|批)$/.test(name)) continue
    // 「汤方 / 汤并丸 / …汤丸」等残标归一
    name = name
      .replace(/汤方$/, '汤')
      .replace(/汤并丸$/, '汤')
      .replace(/并丸$/, '')
      .replace(/方$/, '')
    name = FANGLUN_NAME_ALIAS[name] ?? name
    if (!/(?:汤|散|丸|膏|煎|饮|丹|酒|胶|醴)$/.test(name)) continue
    if (isSpuriousFangshuName(name)) continue
    marks.push({ name, index: match.index, end: match.index + match[0].length })
  }

  for (let i = 0; i < marks.length; i += 1) {
    const current = marks[i]!
    const next = marks[i + 1]
    const body = text.slice(current.end, next?.index ?? text.length).trim()
    if (body.length < 4) continue
    const cut = body.search(/【(?:注|集注|按|方解)】/)
    const composition = trimFanglunCompositionTail(
      stripLeadingZhiBlock((cut >= 0 ? body.slice(0, cut) : body).trim()),
    )
    const lines = joinBrokenHerbLines(
      composition
        .split(/\n+/)
        .map((line) => line.replace(/^[　\s]+/, '').trim())
        .filter(Boolean),
    )

    const herbLines: string[] = []
    const prepLines: string[] = []
    let seenPrep = false
    for (const rawLine of lines) {
      if (seenPrep) {
        prepLines.push(rawLine)
        continue
      }
      let line = stripZhiIndication(rawLine)
      if (!line) continue
      if (/^治/.test(line)) continue
      if (looksLikeIndicationProse(line)) continue
      if (
        /^(?:上|右)[一二三四五六七八九十百]?味|^引用|^加味|^每服|^浓煎|^顿服/.test(line) ||
        (/浓煎顿服|随证加减|须上拣|分两随/.test(line) && !/[（(]/.test(line))
      ) {
        prepLines.push(line)
        seenPrep = true
        continue
      }
      const { herbPart, prepPart } = splitHerbAndPrep(line)
      if (prepPart) {
        prepLines.push(prepPart)
        if (/^(?:上|右)[一二三四五六七八九十百]?味|^水煎|^煎服|^蜜丸|^为细末/.test(prepPart)) {
          seenPrep = true
        }
      }
      if (!herbPart) continue
      // 加减方：「四物汤加人参、黄耆」
      if (/^(?:即)?[\u4e00-\u9fff]{2,12}(?:汤|散|丸).{0,2}(?:加|去)/.test(herbPart)) {
        const addMatch = herbPart.match(/加(.+)$/)
        const removeMatch = herbPart.match(/去(.+)$/)
        if (addMatch?.[1]) {
          herbLines.push(addMatch[1].replace(/[、，,]/g, ' '))
        }
        if (removeMatch?.[1] && !addMatch) {
          // 仅「去」无加：保留方名提示到 preparation
          prepLines.push(herbPart)
        }
        continue
      }
      const cleaned = cleanFanglunHerbLine(herbPart)
        .replace(/[（(]/g, ' ')
        .replace(/[）)]/g, ' ')
      if (
        /[一二三四五六七八九十两钱分升合勺枚各]/.test(cleaned) ||
        /\s/.test(cleaned) ||
        /、/.test(cleaned)
      ) {
        herbLines.push(cleaned.replace(/、/g, ' '))
        continue
      }
      if (cleaned.length <= 40 && /^[\u4e00-\u9fff\s]+$/.test(cleaned) && !/^须|^随|^若/.test(cleaned)) {
        herbLines.push(cleaned)
      }
    }

    let herbs = filterFanglunHerbs(herbLines.flatMap((line) => parseHerbLine(line)))
    if (herbs.length === 0 && herbLines.length > 0) {
      herbs = filterFanglunHerbs(parseHerbLine(herbLines.join(' ')))
    }
    const preparation = prepLines.join('')
    if (herbs.length === 0 && preparation.length === 0) continue
    blocks.push({
      name: current.name,
      body: composition.slice(0, 2000),
      herbs,
      preparation,
    })
  }
  return blocks
}

function parseClassicalComposition(chunk: string): {
  herbs: FormulaHerb[]
  preparation: string
} {
  const lines = chunk
    .split(/\n+/)
    .map((line) => line.replace(/^[:：]\s*/, '').trim())
    .filter(Boolean)
  const herbLines: string[] = []
  const prepLines: string[] = []
  for (const line of lines) {
    if (/^治/.test(line)) continue
    if (/^出第|^肘后|^范汪|^深师|^千金|^崔氏|^仲景|^张文仲|^又方|^论曰|^针灸|^方见前/.test(line)) {
      break
    }
    if (/又方|方见前|导引|五劳|六极/.test(line) && !/[（(]/.test(line)) break
    const { herbPart, prepPart } = splitHerbAndPrep(line)
    // 千金行首「上N味 / 上以水」
    if (/^(?:上|右)(?:[一二三四五六七八九十百]+味|以水|为末|㕮咀|擣|捣|治下)/.test(line)) {
      prepLines.push(line)
      continue
    }
    if (prepPart && !herbPart) {
      prepLines.push(prepPart)
      continue
    }
    if (prepLines.length > 0) {
      prepLines.push(line)
      continue
    }
    if (herbPart) {
      if (/^(?:又方|酒服|治下筛|日三|方寸匕)/.test(herbPart)) continue
      const cleaned = cleanFanglunHerbLine(herbPart)
        .replace(/[（(]/g, ' ')
        .replace(/[）)]/g, ' ')
      herbLines.push(cleaned.replace(/、/g, ' '))
      if (prepPart) prepLines.push(prepPart)
    }
  }
  let herbs = filterFanglunHerbs(herbLines.flatMap((line) => parseHerbLine(line)))
  if (herbs.length === 0 && herbLines.length > 0) {
    herbs = filterFanglunHerbs(parseHerbLine(herbLines.join(' ')))
  }
  return { herbs, preparation: prepLines.join('') }
}

/** 方块截断后紧随的非方名小节（灸法、论曰、「治…方」等），原先被错并进上一方 */
export interface DetachedFangshuSection {
  title: string
  body: string
}

/** 截下的小节正文短于此长度（如「==下乳第九== （方二十一首）」）不单独成条 */
const MIN_DETACHED_SECTION_LENGTH = 8
/** 千金方块条文正文最多取多少字 */
const CLASSICAL_BLOCK_BODY_LENGTH = 1500
/** splitHeadingUnits 的条文级：取不存在的级别，使每个带正文的标题都成独立小节 */
const NO_CLAUSE_HEADING_LEVEL = 0

/**
 * 自 start 起数 count 个非空格/制表符字符，返回终点下标。
 * 旧清洗把全角空格整个删去、现折成半角空格，按此计数才能对齐旧正文窗口。
 */
function advancePastInlineSpaces(text: string, start: number, count: number): number {
  let index = start
  let counted = 0
  while (index < text.length && counted < count) {
    const ch = text[index]
    if (ch !== ' ' && ch !== '\t') counted += 1
    index += 1
  }
  return index
}

/** 千金/外台：===方名=== 或「某某汤方」+ 药味 + 上/右N味 */
export function extractClassicalFangshuBlocks(raw: string): Array<{
  name: string
  body: string
  herbs: FormulaHerb[]
  preparation: string
  detachedSections?: DetachedFangshuSection[]
}> {
  const text = toSimplifiedChinese(cleanWikiBody(raw)).replace(/\r\n/g, '\n')
  const blocks: Array<{
    name: string
    body: string
    herbs: FormulaHerb[]
    preparation: string
    detachedSections?: DetachedFangshuSection[]
  }> = []

  // 优先：=== 桂枝汤 ===；方块止于下一个任意级标题（=== 灸法 ===、== 妊娠恶阻第二 == 属另一小节）
  const headings = listWikiHeadings(text)
  const marks: Array<{ name: string; index: number; end: number; nextHeadingStart: number }> = []
  for (let hi = 0; hi < headings.length; hi += 1) {
    const heading = headings[hi]!
    if (heading.level > 4) continue
    const title = normalizeFormulaName(heading.title)
    if (!FANGLUN_SUFFIX_RE.test(title)) continue
    if (title.length < 2 || title.length > 16) continue
    if (isSpuriousFangshuName(title)) continue
    marks.push({
      name: title,
      index: heading.start,
      end: heading.end,
      nextHeadingStart: headings[hi + 1]?.start ?? text.length,
    })
  }

  for (let i = 0; i < marks.length; i += 1) {
    const current = marks[i]!
    const chunk = text.slice(current.end, current.nextHeadingStart).trim()
    if (chunk.length < 8) continue
    const { herbs, preparation } = parseClassicalComposition(chunk.slice(0, 2500))
    if (herbs.length === 0) continue
    // 只补回旧条文正文窗口内出现过的小节（旧版取到下一方名标题、截 CLASSICAL_BLOCK_BODY_LENGTH 字）
    const firstNonSpace = /\S/g
    firstNonSpace.lastIndex = current.end
    const bodyStart = firstNonSpace.exec(text)?.index ?? text.length
    const legacyBodyEnd = advancePastInlineSpaces(text, bodyStart, CLASSICAL_BLOCK_BODY_LENGTH)
    const detachedText = text.slice(current.nextHeadingStart, marks[i + 1]?.index ?? text.length)
    const detachedSections = splitHeadingUnits(detachedText, NO_CLAUSE_HEADING_LEVEL, MIN_DETACHED_SECTION_LENGTH)
      .filter((unit) => current.nextHeadingStart + unit.start < legacyBodyEnd)
      .map((unit) => ({ title: unit.title, body: unit.body }))
    blocks.push({
      name: current.name,
      body: chunk.slice(0, CLASSICAL_BLOCK_BODY_LENGTH),
      herbs,
      preparation,
      ...(detachedSections.length > 0 ? { detachedSections } : {}),
    })
  }

  // 补充：通用独占行方名 + 嵌入「汤方」（千金大量 === 标题时仍补漏「含香丸方」等）
  {
    const seenNames = new Set(blocks.map((block) => block.name))
    for (const block of extractFormulaBlocks(text)) {
      const name = normalizeFormulaName(block.name)
      if (!FANGLUN_SUFFIX_RE.test(name) || block.herbs.length === 0) continue
      if (isSpuriousFangshuName(name)) continue
      if (seenNames.has(name)) continue
      const herbs = filterFanglunHerbs(block.herbs)
      if (herbs.length === 0) continue
      seenNames.add(name)
      blocks.push({
        name,
        body: '',
        herbs,
        preparation: block.preparation,
      })
    }
  }

  const byName = new Map<string, (typeof blocks)[0]>()
  const classicalJunkRatio = (block: (typeof blocks)[0]): number => {
    if (block.herbs.length === 0) return 1
    const junk = block.herbs.filter((h) =>
      /又方|方寸|治下|日三|酒服|导引|五劳|六极|方见前/.test(h.name),
    ).length
    return junk / block.herbs.length
  }
  for (const block of blocks) {
    if (!block.name || block.herbs.length === 0) continue
    if (/方见前/.test(block.body) && block.herbs.length < 3) continue
    const existing = byName.get(block.name)
    if (!existing) {
      byName.set(block.name, block)
      continue
    }
    const betterClean =
      classicalJunkRatio(block) < classicalJunkRatio(existing) - 0.05 ||
      (Math.abs(classicalJunkRatio(block) - classicalJunkRatio(existing)) <= 0.05 &&
        block.herbs.length > existing.herbs.length)
    if (betterClean) byName.set(block.name, block)
  }
  return [...byName.values()]
}

/** 外台方块无「右N味」收尾时，组成段最多取多少字 */
const WAITAI_COMPOSITION_FALLBACK_CHARS = 600
const WAITAI_VOLUME_END_RE =
  /\n\s*外[台䑓][秘袐]要方?[卷巻][一二三四五六七八九十百]+\s*(?=\n)|\n\s*<子部[,，][^>\n]*>/

/**
 * 《外台秘要》四库本：
 * 「…小柴胡汤主之方」+ {{SK anchor|柴胡}}{{SK notes|半斤}} … + 右七味
 */
export function extractWaitaiBlocks(raw: string): Array<{
  name: string
  body: string
  herbs: FormulaHerb[]
  preparation: string
}> {
  let text = raw.replace(/\r\n/g, '\n')
  // 四库外台药列用全角空格分隔；cleanWikiBody 会删掉　，须先改为普通空格
  text = text.replace(/　+/g, ' ')
  // 先把 SK 药味模板展成「柴胡（半斤）」——须在 cleanWikiBody 剥 notes 之前
  text = text.replace(
    /\{\{SK\s*anchor\|([^}|]+)(?:\|[^}]*)?\}\}(?:\{\{SK\s*notes\|([^}]*)\}\})?/gi,
    (_all, herb: string, note?: string) => {
      const name = toSimplifiedChinese(herb.trim())
      const dose = note ? toSimplifiedChinese(note.trim()) : ''
      return dose ? `${name}（${dose}）` : name
    },
  )
  // 外台常仅首味有 anchor，其后为「栝蔞根{{SK notes|四兩}}桂心{{SK notes|三兩}}」
  // 含扩展 A 区汉字（䜴、䔧等），否则 notes 被剥后药名粘连
  text = text.replace(
    /([\u3400-\u9fff\uf900-\ufaff]{1,12})\{\{SK\s*notes\|([^}]*)\}\}/gi,
    (_all, herb: string, note: string) => {
      const name = toSimplifiedChinese(herb.trim())
      const dose = toSimplifiedChinese(note.trim())
      // 卷末出处 notes（范汪同出…）不当作药量
      if (/出第|卷中|仲景|伤寒|玉函|千金|同出|士弱/.test(dose)) return name
      return `${name}（${dose}）`
    },
  )
  text = toSimplifiedChinese(cleanWikiBody(text))
  // 展平后「）桂心（」无空格；无剂量相邻药也尽量空开（全角空格残留）
  text = text.replace(/）/g, '） ').replace(/　+/g, ' ')

  const blocks: Array<{
    name: string
    body: string
    herbs: FormulaHerb[]
    preparation: string
  }> = []

  /**
   * 外台方名常嵌在长证候后：「…心中悸而烦小建中汤主之方」。
   * 自右向左取「最短且左边界干净」的短名，避免把证候粘进方名。
   */
  const WAITAI_BAD_STEM =
    /伤寒|中风|头痛|项强|腹痛|小便|下利|谵语|胸满|往来|发热|恶寒|身体|骨节|烦闷|不解|脉沉|手足|咽喉|唾脓|泄利|颈项|脇下|心中|心下|结胸|表里|水逆|雷鸣|干呕|心烦|痞坚|不得|不能|发汗|大汗|汗出|微利|潮热|结痛|未解|恶风|无汗|有表|饮水|而吐|辟毒|疫病|贼风|走风|百节|疼痛|牡热|斑出|以后|干粪|脓血|不利|不止|一二|二三|四五|六七|七八|九十|日至|已上|得之|四肢|口中|其背|虚寒|虚热|关格|不通|精神|气逆|炎炎|舌本|强直|体重|虚烦|胆冷|脚弱|神验|肿满|半身|不随|不仁|沉重|体虚|齿痛|痈疽|排脓|内漏|内塞|积聚|作脓|呕吐|虚羸|少气|染着|乍剧|发动|如疟|骨蒸|黄疸|羸瘦|积年|痰疟|吐痢|转筋|白沫|清涎|吞酸|走哺|酸水|蛔虫|心痛|症块|彻背|落马|堕车|急黄|消毒|劳复|食讫|醋咽|多噫|常吐|欲变|鼓胀|气急|流汗|恶水|恶气|宿食|不消|开闗|隔绝|无度|腹中|虚痛|欲入|好吐|筑心|困极|数数|欲吐|食不|两乳|如刺|卒痛|硬筑/
  // 强分隔：证候/动词收尾。勿纳入「心/气/寒/热」等方名常用字，以免桂心三物汤→三物汤
  const WAITAI_SEP =
    /[者用服宜作名以与及属即冝，。；、　\s烦满痛悸呕渇渴利闷强出语后侧血解差证證日安吐食止疗得患愈刺急笃瘦汗温疟痢泻咽噫酸冷冲症块背乳困极羸剧复着死生救効效验劳绝化入足疝思余卧禁度声钱鸡带千状嗽塞液]/

  const extractShortTail = (rawName: string): string | null => {
    let work = rawName
    const parts = work.split(
      /(?:不差|不瘥)?(?:可与|后以|后用|故名|冝服|宜服|当灸之服|必衂血冝|必衄血冝|当须发汗|作此)/,
    )
    work = parts[parts.length - 1]!.replace(/^(?:又|此|作此)+/, '')
    // 剥书名冠称，便于落到真方名
    work = work.replace(
      /^(?:.*?)?(?:崔氏|范汪|千金(?:翼)?|张文仲|救急|广济|深师|仲景|近效|近効|古今录验)/,
      '',
    )
    // 证候比喻/长证粘方名
    work = work
      .replace(/^.*?如水鸡声/, '')
      .replace(/^.*?如带五千钱/, '')
      .replace(/^.*?状如坐水中/, '')
      .replace(/^.*?痛彻心/, '')
      .replace(/^.*?及欬嗽/, '')
      .replace(/^.*?邪气/, '')
      .replace(/^.*?短气/, '')
      .replace(/^.*?不定/, '')
      .replace(/^.*?热中/, '')
      .replace(/^.*?气塞/, '')
    const sufMatch = work.match(/(汤|散|丸|膏|煎|饮|丹)$/)
    if (!sufMatch) return null
    const suf = sufMatch[1]!
    const body = work.slice(0, -suf.length)

    // 自右最短优先：先找到带干净左边界的最短名
    for (let stemLen = 2; stemLen <= 10; stemLen += 1) {
      const i = body.length - stemLen
      if (i < 0) continue
      const stem = body.slice(i)
      const name = stem + suf
      if (name.length > 10) continue
      if (/[者而则也斑后应利脓疼]/.test(stem)) continue
      if (WAITAI_BAD_STEM.test(stem)) continue
      if (/[首卷杂古今病方下焦天行风偏预备录验]/.test(name)) continue
      if (
        /^(?:作|近|欬|煮|煎|气|疼|烦|血|语|解|差|强|侧|以|服|与|属|冝|宜|可|名|此|止|食|得|疗|患|佳|稳|能|特|难|兼|甚|如|则|乃|及|或|曰|乍|乆|令|使|十|口|热|疟|孟|调|脐|泻|乱|多|彻|不禁|欲绝|不化|不入|吸吸|彻心)/.test(
          name,
        )
      ) {
        continue
      }
      if (/寒热温渇烦痛满悸呕眩汗/.test(stem) && stem.length <= 2) continue
      if (/崔氏|范汪|千金|张文仲|救急|广济|深师|仲景|一切|四首|三首|疗/.test(name)) continue

      const left = i > 0 ? body[i - 1]! : ''
      const atSep = i === 0 || WAITAI_SEP.test(left)
      const namedStart = /^(?:小|大|增损)/.test(name)
      if (name.length === 2) {
        if (!atSep && i !== 0) continue
        if (/[煮煎气疼烦血语热寒此毒艾椒含面香黒紫]/.test(stem)) continue
      } else if (!atSep && !namedStart) {
        continue
      }
      if (/煮散$|以后汤$|作此汤$|此汤$|此丸$/.test(name)) continue
      return name
    }
    return null
  }

  // 仅认「…方名主之方 / …方名方」，并从右截取短方名
  const startRe = /([\u4e00-\u9fff]{2,40}(?:汤|散|丸|膏|煎|饮|丹))(?:主之)?方(?=[^\u4e00-\u9fff]|$)/g
  const starts: Array<{ name: string; index: number; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = startRe.exec(text)) !== null) {
    const rawName = normalizeFormulaName(match[1]!)
    const short = extractShortTail(rawName)
    if (!short || short.length < 2 || short.length > 12) continue
    if (/[首卷杂古今病方下焦天行风偏预备录验]/.test(short)) continue
    if (/^[作近欬]/.test(short)) continue
    const ahead = text.slice(match.index + match[0].length, match.index + match[0].length + 400)
    if (
      !/[（(][^）)]{0,16}[两钱分升合斤枚]/.test(ahead) &&
      !/右[一二三四五六七八九十百]+味/.test(ahead)
    ) {
      continue
    }
    starts.push({ name: short, index: match.index, end: match.index + match[0].length })
  }

  for (let i = 0; i < starts.length; i += 1) {
    const current = starts[i]!
    const next = starts[i + 1]
    let chunk = text.slice(current.end, next?.index ?? text.length).slice(0, 2000)
    // 卷界：卷尾题「外台秘要方卷三」/「<子部,医家类,…>」之后是下一卷卷首题与正文
    const volumeEnd = chunk.search(WAITAI_VOLUME_END_RE)
    if (volumeEnd >= 0) chunk = chunk.slice(0, volumeEnd)
    // 硬停：又××方 / 病源 / 仲景论述，避免灌入下一方
    const hardStop = chunk.search(/\n\s*(?:又[\u4e00-\u9fff]{0,20}方|病源|仲景|忌[\u4e00-\u9fff])/)
    if (hardStop > 20) chunk = chunk.slice(0, hardStop)
    const prepIdx = chunk.search(/右[一二三四五六七八九十百]+味/)
    // 无「右N味」时截前若干字；已在卷界截断的块本身就止于本卷，取整段
    const composition = (
      prepIdx >= 0
        ? chunk.slice(0, prepIdx)
        : volumeEnd >= 0
          ? chunk
          : chunk.slice(0, WAITAI_COMPOSITION_FALLBACK_CHARS)
    ).trim()
    const prepTail = prepIdx >= 0 ? chunk.slice(prepIdx).match(/^右[一二三四五六七八九十百]+味[^\n]{0,80}/)?.[0] ?? '' : ''
    if (composition.length < 4) continue

    const herbLine = composition
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && !/^右[一二三四五六七八九十]/.test(line) && !/^忌/.test(line) && !/^又/.test(line))
      .join(' ')
      // 「）桂心（」无空格时切开
      .replace(/）/g, '） ')
      .replace(/）\s+/g, '） ')
    let herbs = filterFanglunHerbs(
      parseHerbLine(cleanFanglunHerbLine(herbLine).replace(/[（(]/g, ' ').replace(/[）)]/g, ' ')),
    )
    if (herbs.length === 0) continue
    // 若「右N味」可知味数，明显少味则仍保留但优先更长块（byName 去重）
    blocks.push({
      name: current.name,
      body: composition.slice(0, 1200),
      herbs,
      preparation: prepTail,
    })
  }

  const byName = new Map<string, (typeof blocks)[0]>()
  for (const block of blocks) {
    const existing = byName.get(block.name)
    if (!existing || block.herbs.length > existing.herbs.length) {
      byName.set(block.name, block)
    }
  }
  return [...byName.values()]
}

const MAX_FANGSHU_CLAUSE_TEXT_LENGTH = 4000

export function buildFangshuDataset(options: {
  bookId: BookId
  raw: string
  mode: 'fanglun' | 'classical' | 'waitai'
  doseSystem: 'han' | 'qing'
  /**
   * 解析修复后才抽得出药味的方块名：排到末尾编号，不挤占既有条文 id（条文 id 按块序号生成）。
   * 每个名字必须恰好命中一块，否则抛错，防止配置过期。
   */
  appendedBlockNames?: readonly string[]
}): FangshuParseResult {
  const { bookId, raw, mode, doseSystem } = options
  const extracted: Array<{
    name: string
    body: string
    herbs: FormulaHerb[]
    preparation: string
    detachedSections?: DetachedFangshuSection[]
  }> =
    mode === 'fanglun'
      ? extractFanglunBlocks(raw)
      : mode === 'waitai'
        ? extractWaitaiBlocks(raw)
        : extractClassicalFangshuBlocks(raw)
  const appendedNames = new Set(options.appendedBlockNames ?? [])
  const isAppended = (block: { name: string }) => appendedNames.has(normalizeFormulaName(block.name))
  for (const name of appendedNames) {
    const hits = extracted.filter((block) => normalizeFormulaName(block.name) === name).length
    assert.equal(hits, 1, `${bookId}: appendedBlockNames「${name}」应恰好命中 1 块，实得 ${hits}`)
  }
  const blocks = [...extracted.filter((block) => !isAppended(block)), ...extracted.filter(isAppended)]

  const formulas: Formula[] = []
  const clauses: Clause[] = []
  const formulaById = new Map<string, Formula>()

  let order = 0
  for (const block of blocks) {
    order += 1
    const name = normalizeFormulaName(block.name)
    if (!name) continue
    const id = `${bookId}-formula-${name}`
    const clauseId = `${bookId}-001-${String(order).padStart(4, '0')}`
    const existing = formulaById.get(id)
    if (existing) {
      if (block.herbs.length > existing.herbs.length) {
        existing.herbs = block.herbs
        existing.preparation = block.preparation || existing.preparation
      }
      if (!existing.sourceClauseIds.includes(clauseId)) {
        existing.sourceClauseIds.push(clauseId)
      }
    } else {
      const formula: Formula = {
        id,
        name,
        book: bookId,
        herbs: block.herbs,
        preparation: block.preparation,
        modifications: [],
        sourceClauseIds: [clauseId],
        chapter: mode === 'fanglun' ? '删补名医方论' : '方剂',
        doseSystem,
        role: 'main',
      }
      formulaById.set(id, formula)
      formulas.push(formula)
    }

    clauses.push({
      id: clauseId,
      book: bookId,
      chapter: mode === 'fanglun' ? '删补名医方论' : '方剂',
      chapterOrder: 1,
      order,
      text: (block.body || `${name}：${block.herbs.map((h) => h.rawText).join('、')}`).slice(
        0,
        MAX_FANGSHU_CLAUSE_TEXT_LENGTH,
      ),
      formulaIds: [id],
      symptomTags: [],
      pulseTags: [],
      channelTags: [],
      pathogenesisTags: [],
      heading: name,
      reviewStatus: 'ai-draft',
    })
  }

  // 被截下的非方名小节排在所有方块之后编号，既有方块条文 id 不变
  for (const block of blocks) {
    if (!normalizeFormulaName(block.name)) continue
    for (const section of block.detachedSections ?? []) {
      order += 1
      clauses.push({
        id: `${bookId}-001-${String(order).padStart(4, '0')}`,
        book: bookId,
        chapter: mode === 'fanglun' ? '删补名医方论' : '方剂',
        chapterOrder: 1,
        order,
        text: section.body.slice(0, MAX_FANGSHU_CLAUSE_TEXT_LENGTH),
        formulaIds: [],
        symptomTags: [],
        pulseTags: [],
        channelTags: [],
        pathogenesisTags: [],
        heading: section.title,
        reviewStatus: 'ai-draft',
      })
    }
  }

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: 1,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
      withHerbs: formulas.filter((f) => f.herbs.length > 0).length,
    },
  }
}

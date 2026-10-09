import type { FormulaHerb } from '../../src/types/data.ts'
import { cleanWikiBody } from './generic-wiki-parse.ts'
import { parseHerbLine } from './formula-parse.ts'
import { isSpuriousHerbName } from './herbs.ts'
import { toSimplifiedChinese } from './wiki.ts'

const FORMULA_SUFFIX_RE = /(?:汤|散|丸|膏|煎|饮子|饮|丹)$/

/** 明确的单味方标志：「右一味」「上一味」「单用」；裸「一味」须紧跟在该药名后（「丹参一味」） */
const SINGLE_HERB_MARKER_RE = /[上右]一味|单用|独用/
/** 药列之后另起一行的制法：「右捣枣肉为丸」「上为末」 */
const PREP_LEAD_LINE_RE = /\n\s*[右上]/
/** 剂量字样（钱/两/分/升/合/枚） */
const JINGYUE_DOSE_RE = /[一二三四五六七八九十百半两\d]+(?:两|钱|分|升|合|枚)|钱半/

/** 去掉括注与空白后比较药列文本 */
function compactHerbText(text: string): string {
  return text.replace(/[\s（）()]/g, '')
}

/**
 * 只解析出一味药时，是否确为单味方（否则多为药列截断，仍按至少两味丢弃）：
 * 1. 药列 / 制法中明确出现单味标志；
 * 2. 这一味带剂量；
 * 3. 药列只有这一味（含括注），其后另起一行即「右/上…」制法（一母丸：知母炒为末，右捣枣肉为丸）。
 */
export function isJingyueSingleHerbFormula(herb: FormulaHerb, herbText: string, preparation: string): boolean {
  if (SINGLE_HERB_MARKER_RE.test(herbText) || SINGLE_HERB_MARKER_RE.test(preparation)) return true
  // 「荞麦一味磨取细面」只证明荞麦是单味，不能为误取到的「臙脂汁」作证
  if (herbText.includes(`${herb.name}一味`)) return true
  if (herb.doseRaw && JINGYUE_DOSE_RE.test(herb.doseRaw)) return true
  const prepLead = herbText.search(PREP_LEAD_LINE_RE)
  if (prepLead < 0) return false
  return compactHerbText(herbText.slice(0, prepLead)) === compactHerbText(herb.rawText)
}

/** 景岳 notes 常含君臣论述，尽量抽出短剂量 */
function simplifyJingyueDose(note: string): string {
  let text = toSimplifiedChinese(note).trim().replace(/^各/, '')
  if (!text) return ''
  if (/方在|即前|用如前|见前|即后/.test(text) && !/[两钱分]/.test(text)) return ''
  const shortTail = text.match(
    /([一二三四五六七八九十两钱分升合枚至或半]+(?:[两钱分升合枚]|钱半)(?:[至或][一二三四五六七八九十两钱分半]+[两钱分升合枚]?)?)$/,
  )
  if (shortTail?.[1] && shortTail[1].length <= 12) return shortTail[1]
  const first = text.match(/[一二三四五六七八九十两半]+[两钱分升合枚]/)
  if (first?.[0]) return first[0]
  if (/钱半$/.test(text) && text.length <= 6) return text.replace(/^各/, '')
  if (text.length <= 8 && /[两钱分炒炙煨]/.test(text)) return text
  // 纯炮制
  if (/^(?:炒|炙|煨|酒炒|盐炒)$/.test(text)) return text
  return ''
}

/** 全角空格药列常见粘连 / 缺字占位 */
function normalizeJingyueHerbText(text: string): string {
  return text
    .replace(/□+/g, '')
    .replace(/茯苓官桂/g, '茯苓 官桂')
    .replace(/白术陈皮/g, '白术 陈皮')
    .replace(/川芎防风/g, '川芎 防风')
    .replace(/羌活独活/g, '羌活 独活')
    .replace(/紫草红花/g, '紫草 红花')
    .replace(/炙甘草藿香/g, '炙甘草 藿香')
    .replace(/肉豆陈皮/g, '肉豆蔻 陈皮')
    .replace(/肉豆䓻/g, '肉豆蔻')
    .replace(/肉荳䓻/g, '肉豆蔻')
    .replace(/肉荳/g, '肉豆蔻')
    .replace(/㯽榔/g, '槟榔')
    .replace(/滑石琥珀/g, '滑石 琥珀')
    .replace(/槟榔猪苓/g, '槟榔 猪苓')
    .replace(/大懐熟地/g, '大怀熟地')
    .replace(/大懐熟(?!地)/g, '大怀熟地')
    .replace(/白石膏/g, '石膏')
    // 「…也明矾」「渴人参」：句末虚词与药名粘连
    .replace(/([也者矣焉渴])([\u3400-\u9fff\uf900-\ufaff]{2,4})(?=\s|$|[（(])/g, '$1 $2')
}

function normalizeJingyueFormulaName(raw: string): string | null {
  let name = toSimplifiedChinese(raw)
    .replace(/['"*＊]/g, '')
    .replace(/[【】\[\]]/g, '')
    .replace(/䓻/g, '蔻')
    .replace(/荳/g, '豆')
    .replace(/肉豆蔻丸/g, '肉豆丸')
    .trim()
  // 四顺清凉饮子 → 四顺清凉饮（与临床习称对齐）
  if (/饮子$/.test(name)) name = `${name.slice(0, -1)}`
  if (!FORMULA_SUFFIX_RE.test(name)) return null
  if (name.length < 2 || name.length > 16) return null
  if (/方在|即前|加减法/.test(name)) return null
  // 「生石膏」以膏结尾，但是药名不是方名
  if (/石膏$/.test(name)) return null
  return name
}

/** SK anchor 是否为方名（避免石膏等药被当成「膏」剂） */
function isJingyueFormulaAnchor(name: string, note?: string): boolean {
  const n = toSimplifiedChinese(name).trim()
  // 白石膏/石膏等药名以膏结尾，不是方剂
  if (/石膏$/.test(n)) return false
  if (/(?:汤|散|丸|煎|饮子|饮|丹)$/.test(n)) return true
  if (/膏$/.test(n)) {
    const dose = note ? toSimplifiedChinese(note).trim() : ''
    // 仅序号 notes 才把「…膏」当方名（两仪膏{{SK notes|十八}}）
    return /^[一二三四五六七八九十百]+$/.test(dose)
  }
  return false
}

function filterJingyueHerbs(herbs: FormulaHerb[]): FormulaHerb[] {
  return herbs.filter((herb) => {
    if (!herb.name || herb.name.length < 2 || herb.name.length > 6) return false
    if (isSpuriousHerbName(herb.name)) return false
    // 方名碎片（即前四君子汤 → 君子汤）
    if (/(?:汤|散|丸|煎|饮|丹)$/.test(herb.name)) return false
    if (/证|症|等证|等症/.test(herb.name)) return false
    if (/^治|^水|^煎|^食|^温|^冷|^如|^若|^多|^少|^即|^用|^或|^各|^右|^加|^一|^亦|^又/.test(herb.name)) {
      return false
    }
    if (/钟$|分$|服$|钱半$|皮也$/.test(herb.name)) return false
    if (/各钱|或加|姜枣|皮也|七分或/.test(herb.name)) return false
    // 炮制语误作药名
    if (/浸切|米泔|切炒|酒蒸|面煨|麪煨|将成|滚数|白汤|调服/.test(herb.name)) return false
    return true
  })
}

/** 煎服截点：优先「水N钟/水煎/右为末」；勿把主治里的「浸冷服」当成煎服法 */
function findJingyuePrepIndex(chunk: string): number {
  const strong = chunk.search(
    /水[一二三四五六七八九十两半]+钟|水[一二三四五六七八九十两半]+杯|水煎服|加水煎|水煎|右为细末|右为末|右用酒水|右用酒|右用水|右㕮咀|右咀|右丸|右件|右先将|食远温服|食远服/,
  )
  if (strong >= 0) return strong
  // 仅匹配独立「温服/冷服」，排除「浸冷服」
  const weak = chunk.search(/(?<!浸)(?:温服|冷服)/)
  return weak
}

/** 「一名国老饮」「亦名活血散」「良方名姜草汤」（勿匹配「即名」以免误挂） */
function extractJingyueAliasNames(chunk: string): string[] {
  const aliases: string[] = []
  const re =
    /(?:一名|亦名|又名|良方名)\s*([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮|丹|饮子)?)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(chunk)) !== null) {
    let rawName = match[1]!
    if (rawName.endsWith('饮子')) rawName = rawName.slice(0, -1)
    const name = normalizeJingyueFormulaName(rawName)
    if (name) aliases.push(name)
  }
  return aliases
}

const INDIC_TAIL_RE = /证|症|也|者|宜|非|等|治|此|凡|方|剂|服|煎|述|用|妙/
/** 含扩展 A（㯽榔等） */
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/
const CJK_ONLY_RE = /^[\u3400-\u9fff\uf900-\ufaff]+$/

function isLeadHerbToken(token: string): boolean {
  return (
    token.length >= 2 &&
    token.length <= 4 &&
    CJK_ONLY_RE.test(token) &&
    !INDIC_TAIL_RE.test(token)
  )
}

/** 去掉「治/此/一名…」主治，保留其后空格药列（含无括注人参　白术） */
function stripJingyueIndication(composition: string): string {
  let herbText = normalizeJingyueHerbText(composition.replace(/^（序[^）]*）/, '').trim())
  // 「一名托里十补散○调气…亦治痈疽」——先剥别名行，再剥主治
  herbText = herbText
    .replace(/^(?:又名|一名|亦名)[\u4e00-\u9fff]{1,16}(?:汤|散|丸|膏|煎|饮|丹|饮子)?[○\s]*/, '')
    .trim()

  const looksIndic =
    /^(?:治|此|凡|调|大能|破|杀|开胃)/.test(herbText) ||
    /(?:等证|等症|主之|宜此|方也|之方也)/.test(herbText.slice(0, 160))
  if (!looksIndic) return herbText

  // 以首个「药名（剂量）」为锚，向前收回无括注药名
  const doseHerb = herbText.search(/[\u3400-\u9fff\uf900-\ufaff]{2,6}[（(][^）)]{0,24}[）)]/)
  if (doseHerb >= 0) {
    const tokens = normalizeJingyueHerbText(herbText.slice(0, doseHerb))
      .split(/\s+/)
      .filter(Boolean)
    const lead: string[] = []
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i]!
      if (isLeadHerbToken(token)) lead.unshift(token)
      else if (/^炙[\u3400-\u9fff\uf900-\ufaff]{2}$/.test(token) || /^[\u3400-\u9fff\uf900-\ufaff]{2}药$/.test(token)) {
        lead.unshift(token)
      } else if (token.length <= 1) continue
      // 扩展区粘连未拆时跳过，勿中断前方药列
      else if (CJK_RE.test(token) && token.length <= 6 && !INDIC_TAIL_RE.test(token)) {
        lead.unshift(token)
      } else break
    }
    return `${lead.length ? `${lead.join(' ')} ` : ''}${herbText.slice(doseHerb).trim()}`.trim()
  }

  // 「即前X加/去Y」留给二次解析
  if (/即前[\u4e00-\u9fff]{2,12}(?:汤|散|丸|煎|饮)(?:加|去)/.test(herbText)) {
    const ref = herbText.match(/即前[\u4e00-\u9fff]{2,12}(?:汤|散|丸|煎|饮)(?:加|去)[\s\S]+/)
    if (ref) return ref[0]!
  }
  if (/^即前[\u4e00-\u9fff]{2,12}(?:汤|散|丸|煎|饮)\s*$/.test(herbText)) {
    return herbText.trim()
  }

  // 无括注药列：从首个像样药名 token 切开（人参　黄芪…）
  const spaced = herbText.search(
    /(?:^|[\s○])([\u3400-\u9fff\uf900-\ufaff]{2,4})(?:\s+[\u3400-\u9fff\uf900-\ufaff]{2,4}){1,}/,
  )
  if (spaced >= 0) {
    const from = herbText.slice(spaced).replace(/^[○\s]+/, '')
    const parts = spacedHerbParts(from)
    if (parts.length >= 2) return from.trim()
  }

  // 全无括注 / 无空格粘连：截掉「等证」套语
  const cut = herbText.search(/(?:等证|等症|主之|宜此|剂也|方也|之方也|不可尽述|非所宜)/)
  if (cut >= 0) {
    const matched = herbText
      .slice(cut)
      .match(/(?:等证|等症|主之|宜此|剂也|方也|之方也|不可尽述|非所宜)[○\s]*/)
    const after = herbText.slice(cut + (matched?.[0].length ?? 2)).trim()
    if (after.length >= 4) return after
  }

  // 句号后常接药列；○ 后若仍是主治散文则再切
  const period = herbText.search(/[。]/)
  if (period >= 0) {
    const after = herbText.slice(period + 1).trim()
    if (after.length >= 4 && !/^按/.test(after)) return after
  }
  const circle = herbText.search(/○/)
  if (circle >= 0) {
    const after = herbText.slice(circle + 1).trim()
    if (spacedHerbParts(after).length >= 2) return after
  }
  return herbText
}

function spacedHerbParts(herbText: string): string[] {
  return normalizeJingyueHerbText(herbText)
    .split(/\s+/)
    .map((part) => part.replace(/[（(][^）)]*[）)]/g, '').trim())
    .filter(
      (part) =>
        isLeadHerbToken(part) &&
        !/(?:汤|散|丸|煎|饮|丹)$/.test(part) &&
        !/^水|^如|^加|^右/.test(part) &&
        !/皮也|姜枣|等证|等症/.test(part),
    )
}

function parseAddedHerbs(addition: string): FormulaHerb[] {
  const text = normalizeJingyueHerbText(addition)
    .replace(/[（(]/g, ' ')
    .replace(/[）)]/g, ' ')
    .trim()
  // 「陈皮半夏各一钱五分」：优先按二字药切开（parseHerbLine 的 {2,3} 会粘成陈皮半）
  const each = text.match(
    /^((?:[\u4e00-\u9fff]{2}){2,4})各([一二三四五六七八九十两半]+[钱分两].*)$/,
  )
  if (each) {
    const names = each[1]!.match(/[\u4e00-\u9fff]{2}/g) ?? []
    const dose = each[2] ?? ''
    if (names.length >= 2 && names.join('') === each[1]) {
      return filterJingyueHerbs(
        names.map((name) => ({
          herbId: name,
          name,
          rawText: `${name}${dose}`,
          doseRaw: dose,
        })),
      )
    }
  }
  const fromLine = filterJingyueHerbs(parseHerbLine(text))
  if (fromLine.length >= 1) return fromLine
  return filterJingyueHerbs(
    spacedHerbParts(text).map((name) => ({
      herbId: name,
      name,
      rawText: name,
      doseRaw: '',
    })),
  )
}

/**
 * 《景岳全书》卷51–64 新方/古方八阵：
 * 大补元煎{{SK notes|一}}…{{SK anchor|人参}}{{SK notes|…}}山药{{SK notes|炒二钱}}…
 */
export function extractJingyueFangzhenBlocks(raw: string): Array<{
  name: string
  herbs: FormulaHerb[]
  preparation: string
  chapter: string
}> {
  // 仅取方卷
  const volRe = /<!--\s*SUBPAGE:\s*[^\n]*?\/卷(5[1-9]|6[0-4])\s*-->/g
  const marks: Array<{ vol: string; index: number }> = []
  let match: RegExpExecArray | null
  while ((match = volRe.exec(raw)) !== null) {
    marks.push({ vol: `卷${match[1]}`, index: match.index })
  }
  if (marks.length === 0) return []

  const blocks: Array<{
    name: string
    herbs: FormulaHerb[]
    preparation: string
    chapter: string
  }> = []
  const pendingRefs: Array<{
    name: string
    baseName: string
    addition: string
    removal: string
    preparation: string
    chapter: string
  }> = []

  for (let vi = 0; vi < marks.length; vi += 1) {
    const current = marks[vi]!
    const next = marks[vi + 1]
    let slice = raw.slice(current.index, next?.index ?? raw.length)
    slice = slice.replace(/　+/g, ' ')
    // SKchar 占位会打断「肉荳䓻丸」——先去掉使方名/药名粘合
    slice = slice.replace(/\{\{SKchar\|3587\}\}/gi, '䓻')
    slice = slice.replace(/\{\{SKchar\|[^}]*\}\}/gi, '')
    // 展平 SK 模板（须在 cleanWikiBody 之前）
    slice = slice.replace(
      /\{\{SK\s*anchor\|([^}|]+)(?:\|[^}]*)?\}\}(?:\{\{SK\s*notes\|([^}]*)\}\})?/gi,
      (_all, herb: string, note?: string) => {
        const name = toSimplifiedChinese(herb.trim())
        // 方名作 anchor：左归饮{{SK notes|二}}
        if (isJingyueFormulaAnchor(name, note)) {
          const dose = note ? toSimplifiedChinese(note.trim()) : ''
          return `\n【FANG:${name}】${dose ? `（序${dose}）` : ''}\n`
        }
        const dose = note ? simplifyJingyueDose(note) : ''
        return dose ? `${name}（${dose}） ` : `${name} `
      },
    )
    slice = slice.replace(
      /([\u3400-\u9fff\uf900-\ufaff]{2,12})\{\{SK\s*notes\|([^}]*)\}\}/gi,
      (_all, herb: string, note: string) => {
        const name = toSimplifiedChinese(herb.trim())
        const doseNote = toSimplifiedChinese(note.trim())
        // 方名+序号：大补元煎{{SK notes|一}}
        if (
          isJingyueFormulaAnchor(name, doseNote) &&
          /^[一二三四五六七八九十百]+$/.test(doseNote)
        ) {
          return `\n【FANG:${name}】（序${doseNote}）\n`
        }
        if (/方在|即前|用如前/.test(doseNote) && !/[两钱]/.test(doseNote)) {
          return `${name} `
        }
        const dose = simplifyJingyueDose(doseNote)
        return dose ? `${name}（${dose}） ` : `${name} `
      },
    )
    const text = toSimplifiedChinese(cleanWikiBody(slice)).replace(/）/g, '） ')

    const fangRe = /【FANG:([^】]+)】/g
    const fangMarks: Array<{ name: string; index: number; end: number }> = []
    while ((match = fangRe.exec(text)) !== null) {
      const name = normalizeJingyueFormulaName(match[1]!)
      if (!name) continue
      fangMarks.push({ name, index: match.index, end: match.index + match[0].length })
    }

    for (let i = 0; i < fangMarks.length; i += 1) {
      const fang = fangMarks[i]!
      const nextFang = fangMarks[i + 1]
      let chunk = text.slice(fang.end, nextFang?.index ?? fang.end + 800)
      // 索引条「方在寒阵」无药
      if (/^（序[^）]*）?\s*方在/.test(chunk) || /^方在/.test(chunk.trim())) continue
      const prepIdx = findJingyuePrepIndex(chunk)
      const composition = (prepIdx >= 0 ? chunk.slice(0, prepIdx) : chunk.slice(0, 400)).trim()
      const prep =
        prepIdx >= 0
          ? chunk.slice(prepIdx).match(/^(?:水[^\n○]{0,40}|右[^\n○]{0,40}|食远[^\n○]{0,40}|温服[^\n○]{0,20}|冷服[^\n○]{0,20})/)?.[0] ??
            ''
          : ''
      const aliasNames = extractJingyueAliasNames(composition)
      let herbText = stripJingyueIndication(composition)
      herbText = normalizeJingyueHerbText(
        herbText
          // 仅去掉药列后的○按语，勿吞掉「一名…○主治」后的药味
          .replace(/○按[\s\S]*$/g, ' ')
          .replace(/○此方[\s\S]*$/g, ' ')
          .replace(/如[^。]{0,40}者[去加][^。]{0,30}/g, ' ')
          .replace(/加姜枣|右加姜枣|加薑棗/g, ' ')
          .trim(),
      )
      const refAdd = herbText.match(
        /即前\s*([\u4e00-\u9fff]{2,12}(?:汤|散|丸|煎|饮))加(.+)/,
      )
      const refRemove = herbText.match(
        /即前\s*([\u4e00-\u9fff]{2,12}(?:汤|散|丸|煎|饮))(?:去|减|减去)(.+)/,
      )
      const refOnly = herbText.match(
        /^即前\s*([\u4e00-\u9fff]{2,12}(?:汤|散|丸|煎|饮))\s*$/,
      )
      if (refAdd || refRemove || refOnly) {
        const baseName = (refAdd?.[1] ?? refRemove?.[1] ?? refOnly?.[1])!
        const addition = refAdd?.[2] ?? ''
        const removal = (refRemove?.[2] ?? '').replace(/^去|^减/, '')
        pendingRefs.push({
          name: fang.name,
          baseName,
          addition,
          removal,
          preparation: prep,
          chapter: current.vol,
        })
        for (const alias of aliasNames) {
          pendingRefs.push({
            name: alias,
            baseName,
            addition,
            removal,
            preparation: prep,
            chapter: current.vol,
          })
        }
        continue
      }
      herbText = herbText
        .replace(/此即[\u4e00-\u9fff]{2,12}加[\u4e00-\u9fff]{0,8}/g, ' ')
        .trim()
      if (!herbText || herbText.length < 4) continue
      let herbs = filterJingyueHerbs(
        parseHerbLine(herbText.replace(/[（(]/g, ' ').replace(/[）)]/g, ' ')),
      )
      // 无括注 / 括注不全：用空格药列补全（人参　白术　茯苓）
      const parts = spacedHerbParts(herbText)
      if (herbs.length < 2 && parts.length >= 2) {
        herbs = filterJingyueHerbs(
          parts.slice(0, 14).map((name) => ({
            herbId: name,
            name,
            rawText: name,
            doseRaw: '',
          })),
        )
      } else if (parts.length > herbs.length) {
        const known = new Set(herbs.map((h) => h.name))
        const merged = [
          ...parts
            .filter((name) => !known.has(name))
            .map((name) => ({
              herbId: name,
              name,
              rawText: name,
              doseRaw: '',
            })),
          ...herbs,
        ]
        herbs = filterJingyueHerbs(merged).slice(0, 14)
      }
      // 单味有剂量亦可（外台苦楝汤：苦楝根…二两）
      let singleFromFallback = false
      if (herbs.length < 2) {
        const single = herbText.match(
          /(苦楝根|([\u3400-\u9fff\uf900-\ufaff]{2,6}))[^。\n]{0,36}?([一二三四五六七八九十两半]+(?:两|钱|分))/,
        )
        if (single) {
          const name = (single[1] === '苦楝根' ? '苦楝根' : single[2] || single[1])!
          const dose = single[3]!
          if (name.length >= 2 && name.length <= 6 && !/(?:汤|散|丸|煎|饮)/.test(name)) {
            herbs = filterJingyueHerbs([
              { herbId: name, name, rawText: `${name}${dose}`, doseRaw: dose },
            ])
            singleFromFallback = true
          }
        }
      }
      if (herbs.length < 1) continue
      // 正则兜底取到的「名+剂量」可能是主治文字，仍只放行苦楝方
      if (
        herbs.length < 2 &&
        !/苦楝/.test(fang.name) &&
        (singleFromFallback || !isJingyueSingleHerbFormula(herbs[0]!, herbText, prep))
      ) {
        continue
      }
      const entry = {
        name: fang.name,
        herbs,
        preparation: prep,
        chapter: current.vol,
      }
      blocks.push(entry)
      for (const alias of aliasNames) {
        if (alias === fang.name) continue
        blocks.push({
          name: alias,
          herbs: herbs.map((herb) => ({ ...herb })),
          preparation: prep,
          chapter: current.vol,
        })
      }
    }
  }

  const byName = new Map<string, (typeof blocks)[0]>()
  for (const block of blocks) {
    const existing = byName.get(block.name)
    if (!existing || block.herbs.length > existing.herbs.length) {
      byName.set(block.name, block)
    }
  }

  // 「即前四君子汤加陈皮半夏」「即前五苓散去肉桂」→ 继承底方
  for (const ref of pendingRefs) {
    const base = byName.get(ref.baseName)
    if (!base || base.herbs.length < 2) continue
    const removeNames = new Set(
      ref.removal
        ? spacedHerbParts(ref.removal.replace(/[、，,]/g, ' ')).concat(
            parseAddedHerbs(ref.removal).map((herb) => herb.name),
          )
        : [],
    )
    let herbs = base.herbs
      .filter((herb) => !removeNames.has(herb.name))
      .map((herb) => ({ ...herb }))
    if (ref.addition) {
      const added = parseAddedHerbs(ref.addition)
      const known = new Set(herbs.map((herb) => herb.name))
      herbs = [...herbs, ...added.filter((herb) => !known.has(herb.name))]
    }
    if (herbs.length < 2) continue
    const existing = byName.get(ref.name)
    if (!existing || existing.herbs.length < herbs.length) {
      byName.set(ref.name, {
        name: ref.name,
        herbs,
        preparation: ref.preparation || existing?.preparation || '',
        chapter: ref.chapter,
      })
    }
  }

  // 正文「即前方加陈皮…半夏即名橘半枳术丸」类派生
  const zhiZhu = byName.get('枳术丸')
  if (zhiZhu && zhiZhu.herbs.length >= 2 && !byName.has('橘半枳术丸')) {
    const known = new Set(zhiZhu.herbs.map((herb) => herb.name))
    const extra = ['陈皮', '半夏']
      .filter((name) => !known.has(name))
      .map((name) => ({ herbId: name, name, rawText: name, doseRaw: '' }))
    byName.set('橘半枳术丸', {
      name: '橘半枳术丸',
      herbs: [...zhiZhu.herbs.map((herb) => ({ ...herb })), ...extra],
      preparation: zhiZhu.preparation,
      chapter: zhiZhu.chapter,
    })
  }

  // 「大承气汤…河间加甘草名三一承气汤」
  const daChengQi = byName.get('大承气汤')
  if (daChengQi && daChengQi.herbs.length >= 2) {
    const existing = byName.get('三一承气汤')
    const needsGancao = !existing?.herbs.some((herb) => herb.name === '甘草')
    if (!existing || needsGancao || existing.herbs.length < daChengQi.herbs.length) {
      const known = new Set(daChengQi.herbs.map((herb) => herb.name))
      const herbs = [...daChengQi.herbs.map((herb) => ({ ...herb }))]
      if (!known.has('甘草')) {
        herbs.push({ herbId: '甘草', name: '甘草', rawText: '甘草', doseRaw: '' })
      }
      byName.set('三一承气汤', {
        name: '三一承气汤',
        herbs,
        preparation: daChengQi.preparation,
        chapter: daChengQi.chapter,
      })
    }
  }

  // 消痞大成膏 ← 消痞膏（正文云加芦荟木香蝉酥即名）；勿保留误挂的超长脏方
  const xiaoPi = byName.get('消痞膏')
  if (xiaoPi && xiaoPi.herbs.length >= 2) {
    const existing = byName.get('消痞大成膏')
    if (!existing || existing.herbs.length > 20 || existing.herbs.length < xiaoPi.herbs.length) {
      byName.set('消痞大成膏', {
        name: '消痞大成膏',
        herbs: xiaoPi.herbs.map((herb) => ({ ...herb })),
        preparation: xiaoPi.preparation,
        chapter: xiaoPi.chapter,
      })
    }
  }

  // 良方名姜草汤 = 甘草干姜汤
  const ganCaoGanJiang = byName.get('甘草干姜汤')
  if (ganCaoGanJiang && ganCaoGanJiang.herbs.length >= 2) {
    for (const alias of ['姜草汤', '薑草汤']) {
      const existing = byName.get(alias)
      if (!existing || existing.herbs.length < ganCaoGanJiang.herbs.length) {
        byName.set(alias, {
          name: alias === '薑草汤' ? '姜草汤' : alias,
          herbs: ganCaoGanJiang.herbs.map((herb) => ({ ...herb })),
          preparation: ganCaoGanJiang.preparation,
          chapter: ganCaoGanJiang.chapter,
        })
      }
    }
  }

  // 八阵散文：「肉荳丸治…滑泄肉荳苍术干姜…」无 SK 药列时粘连二字药
  for (let vi = 0; vi < marks.length; vi += 1) {
    const current = marks[vi]!
    const next = marks[vi + 1]
    let slice = raw.slice(current.index, next?.index ?? raw.length)
    slice = toSimplifiedChinese(cleanWikiBody(slice.replace(/　+/g, ' ')))
    const proseRe =
      /([\u4e00-\u9fff]{2,10}(?:汤|散|丸|煎|饮|丹))治[\u4e00-\u9fff]{2,40}?((?:肉豆蔻|炙甘草|[\u3400-\u9fff\uf900-\ufaff]{2}){3,16})(?=[右上水]|[。．]|$)/g
    let proseMatch: RegExpExecArray | null
    while ((proseMatch = proseRe.exec(slice)) !== null) {
      const name = normalizeJingyueFormulaName(proseMatch[1]!)
      if (!name) continue
      if (byName.has(name) && (byName.get(name)?.herbs.length ?? 0) >= 2) continue
      const sticky = normalizeJingyueHerbText(proseMatch[2]!)
      const names: string[] = []
      let rest = sticky.replace(/\s+/g, '')
      while (rest.length >= 2) {
        if (rest.startsWith('肉豆蔻')) {
          names.push('肉豆蔻')
          rest = rest.slice(3)
          continue
        }
        if (rest.startsWith('炙甘草')) {
          names.push('炙甘草')
          rest = rest.slice(3)
          continue
        }
        names.push(rest.slice(0, 2))
        rest = rest.slice(2)
      }
      const herbs = filterJingyueHerbs(
        names.slice(0, 14).map((herbName) => ({
          herbId: herbName,
          name: herbName,
          rawText: herbName,
          doseRaw: '',
        })),
      )
      if (herbs.length < 3) continue
      byName.set(name, {
        name,
        herbs,
        preparation: '',
        chapter: current.vol,
      })
    }
  }

  return [...byName.values()]
}

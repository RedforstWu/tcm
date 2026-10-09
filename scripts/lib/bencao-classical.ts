import { toSimplifiedChinese } from './wiki.ts'

/** 规范药名：去括注、注音、为君等 */
export function cleanHerbDisplayName(name: string): string {
  let text = toSimplifiedChinese(name).normalize('NFKC').trim()
  text = text.replace(/[【】\[\]]/g, '')
  text = text.replace(/（[^）]*）/g, '')
  text = text.replace(/\([^)]*\)/g, '')
  text = text.replace(/[?？□]/g, '')
  text = text.replace(/(为君|国老|音[^\u4e00-\u9fff]*)/g, '')
  text = text.replace(/[^\u4e00-\u9fff0-9]/g, '')
  return text
}

/**
 * 从专论开头解析性味毒。
 * 只看「味…」首句（到主/主治/久服 或前 80 字），避免正文「邪气寒热」等误匹配。
 */
export function parseClassicalMeta(text: string): {
  nature?: string
  flavor?: string
  channels: string[]
  toxicity?: string
} {
  const simplified = toSimplifiedChinese(text).replace(/\s+/g, '')
  // 截取药性头：味… 到 主/主治/久服/一名 或 80 字
  const headStart = simplified.search(/味/)
  const fromTaste = headStart >= 0 ? simplified.slice(headStart, headStart + 80) : simplified.slice(0, 80)
  const headCut = fromTaste.search(/(?:主治|久服|一名|一名曰|解[^毒]|杀|除|疗|治[^疗])/)
  const head = headCut > 0 ? fromTaste.slice(0, headCut) : fromTaste

  // 味甘、辛，温 / 味甘辛温 / 味甘，微寒，无毒
  const tasteMatch = head.match(
    /味\s*([甘辛苦酸咸淡涩、，,]+)\s*([大小微]?(?:寒|热|温|凉|平))?(?:[、，,]?\s*([大小微]?(?:寒|热|温|凉|平)))?/,
  )
  let flavor: string | undefined
  let nature: string | undefined
  if (tasteMatch) {
    flavor = tasteMatch[1]!.replace(/[、，,\s]/g, '').replace(/[^甘辛苦酸咸淡涩]/g, '') || undefined
    nature = tasteMatch[2] || tasteMatch[3] || undefined
  }
  // 味后性字可能被逗号隔开：味甘，微寒
  if (!nature) {
    const afterTaste = head.match(/味[^寒热温凉平主]{0,16}?([大小微]?(?:寒|热|温|凉|平))/)
    if (afterTaste) nature = afterTaste[1]
  }
  // 气寒 / 气平 —— 仅在头段、紧跟「气」且后接毒/主
  if (!nature) {
    const qi = head.match(/气([寒热温凉平])(?:[，。；]|无毒|有毒|主|$)/)
    if (qi) nature = qi[1]
  }

  const toxicityMatch = head.match(/(无毒|有小毒|有毒|小毒|大毒|微毒)/)
  return {
    flavor,
    nature,
    channels: [],
    toxicity: toxicityMatch?.[1],
  }
}

/** 经典文献中确有单字药名；其余单字多为篇名截断，默认丢弃 */
const ALLOWED_SINGLE_CHAR_HERBS = new Set(
  '术蟹韭葱蒜姜桂栗桐柳榆柏松竹茶蜜蜡矾盐酒醋酪酥雉鸠鸽鸡鸭鹅猪狗马牛羊鹿麝蛇蜂蚕蚓蛭蛙珂柿芋梨柰菘芥薤苏漆蜜胶铅铁铜金银玉石水火土'.split(''),
)

export function looksLikeHerbName(name: string): boolean {
  const clean = cleanHerbDisplayName(name)
  if (clean.length < 1 || clean.length > 8) return false
  if (clean.length === 1 && !ALLOWED_SINGLE_CHAR_HERBS.has(clean)) return false
  if (/^(序|跋|目录|凡例|提要|卷|部|上品|中品|下品)/.test(clean)) return false
  if (/序$|图经|校勘|附录/.test(clean)) return false
  if (/^(虫鱼|菜|果|米|玉石|草|木|兽|禽)[上下中]?$/.test(clean)) return false
  if (/^药有/.test(clean)) return false
  return true
}

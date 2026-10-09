import type { FormulaHerb } from '../../src/types/data.ts'
import { parseHerbLine } from './formula-parse.ts'
import {
  cleanWikiBody,
  isPlausibleFormulaName,
  roughParseHerbs,
  splitWikiSections,
  type WenbingFormulaBlock,
} from './generic-wiki-parse.ts'
import { toSimplifiedChinese } from './wiki.ts'

function cleanHerbs(herbs: FormulaHerb[]): FormulaHerb[] {
  return herbs
    .map((herb) => {
      let name = herb.name
        .replace(/末$/, '')
        .replace(/(?:各)?[一二三四五六七八九十百半]+(?:两|钱|分|厘|枚)$/g, '')
        .trim()
      if (name === '没药') return { ...herb, name, herbId: '没药' }
      if (name === '麝香') return { ...herb, name, herbId: '麝香' }
      if (name !== herb.name) return { ...herb, name, herbId: name || herb.herbId }
      return herb
    })
    .filter((herb) => {
      if (!herb.name || herb.name.length > 6 || herb.name.length < 2) return false
      if (/者$|煮取|煎法|服法|方论|加减|即于|渣再|共为|他变|澄清|定获|奇效|接服|大半|十一味|去渣/.test(herb.name))
        return false
      if (/杯$|钟$|服$|渣$/.test(herb.name)) return false
      if (/[两钱分厘]/.test(herb.name)) return false
      if (/^[一二三四五六七八九十百]+$/.test(herb.name)) return false
      if (/可多多|脱然全愈|当点心|大便久|年七旬|脑中作|或偏枯|方中之|煎十余|共药/.test(herb.name))
        return false
      // 括注炮制说明误作药名（根叶茎花皆用 / 花开残者去之）
      if (/皆用|去之|代之|无鲜|干者|宜用鲜|加怀/.test(herb.name)) return false
      return true
    })
}

function normalizeZhongxiName(raw: string): string {
  return raw
    .replace(/^[0-9０-９一二三四五六七八九十百]+[．.\u3001]\s*/, '')
    .replace(/^[（(]\d+[）)]\s*/, '')
    .replace(/湯/g, '汤')
    .replace(/飲/g, '饮')
    .trim()
}

function parseHerbLines(lines: string[]): FormulaHerb[] {
  const joined = lines.join(' ').replace(/['"*＊]/g, ' ').trim()
  if (!joined) return []
  let herbs = cleanHerbs(parseHerbLine(joined).slice(0, 18))
  if (herbs.length < 2) herbs = cleanHerbs(roughParseHerbs(joined).slice(0, 16))
  return herbs
}

function collectDoseLines(body: string, maxLines = 8): string[] {
  const lines = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const doseLines: string[] = []
  for (const line of lines.slice(0, 14)) {
    if (/^(?:治|按|附录|或问|愚|一方|此方|【|'''|即前|其方即|若前)/.test(line)) {
      if (doseLines.length > 0) break
      continue
    }
    if (/即前方|即于前方|其方即/.test(line) && doseLines.length === 0) return []
    const parenCount = (line.match(/[（(]/g) || []).length
    // 单味长括注：「鲜蒲公英（四两，根叶茎花皆用…）」
    const singleLong =
      parenCount >= 1 &&
      /[两钱分厘升合粒枚]/.test(line) &&
      line.length < 200 &&
      /^[\u4e00-\u9fff]{2,8}[（(]/.test(line)
    const looksDose =
      singleLong ||
      (parenCount >= 1 && /[两钱分厘升合粒枚]/.test(line) && line.length < 120) ||
      (/、/.test(line) && /各?[一二三四五六七八九十]+[钱两分]/.test(line) && line.length < 100)
    if (!looksDose) {
      if (doseLines.length > 0) break
      continue
    }
    // 长括注只保留「药名（剂量…）」首段，避免把「如无鲜者…」拆成伪药
    if (singleLong && line.length > 40) {
      const head = line.match(/^([\u4e00-\u9fff]{2,8}[（(][^）)]*[两钱分厘][^）)]*[）)])/)
      doseLines.push(head?.[1] ?? line.slice(0, 40))
    } else {
      doseLines.push(line)
    }
    if (doseLines.length >= maxLines) break
  }
  return doseLines
}

function parseDerivedZhongxiLine(line: string): WenbingFormulaBlock | null {
  const text = line.replace(/\s+/g, '')
  // 即前方加鲜小蓟根二两
  const forward = text.match(/^即前方加([\u4e00-\u9fff]{2,12}?)([一二三四五六七八九十两钱分两]+.*)?$/)
  if (forward) {
    const addRaw = `${forward[1]}${forward[2] ?? ''}`.replace(/[。；].*$/, '')
    const addHerbs = cleanHerbs(parseHerbLine(addRaw).slice(0, 8))
    if (addHerbs.length === 0) {
      const nameOnly = forward[1]!
      if (nameOnly.length >= 2 && nameOnly.length <= 6) {
        return {
          name: '',
          herbs: [{ herbId: nameOnly, name: nameOnly, rawText: addRaw, doseRaw: forward[2] ?? '' }],
          preparation: '',
          baseName: '__PREV__',
        }
      }
      return null
    }
    return { name: '', herbs: addHerbs, preparation: '', baseName: '__PREV__' }
  }

  // 其方即滋阴宣解汤，去连翘、蝉蜕 / 其方即宣解汤加生山药一两
  const namely = text
    .replace(/[。．.]+$/g, '')
    .match(
      /^其方即([\u4e00-\u9fff]{2,16}?)(?:汤|散|丸|膏|煎|饮)?(?:，|,)?(?:去([\u4e00-\u9fff、，,]{2,30}))?(?:，|,)?(?:加(.+))?$/,
    )
  if (namely) {
    let baseName = namely[1]!
    if (!/(?:汤|散|丸|膏|煎|饮|丹)$/.test(baseName)) baseName = `${baseName}汤`
    const removeNames = (namely[2] ?? '')
      .split(/[、，,]/g)
      .map((part) => part.replace(/[。．.]/g, '').trim())
      .filter((part) => part.length >= 2 && part.length <= 6)
    let addRaw = namely[3] ?? ''
    // 「加生山药一两，甘草改用三钱」只取加味，丢改用说明
    addRaw = addRaw.split(/[，,]甘草改|[，,]改用|[。；]/)[0] ?? addRaw
    const addHerbs = addRaw ? cleanHerbs(parseHerbLine(addRaw).slice(0, 8)) : []
    if (removeNames.length === 0 && addHerbs.length === 0) return null
    return { name: '', herbs: addHerbs, preparation: '', baseName, removeNames }
  }

  // 此方减麦冬、知母三分之一…名健运丸 — 由外层处理
  return null
}

/**
 * 《衷中参西录》医方标题块：=== N．方名 === + 括注剂量药列；
 * 附方【方名】括注药列；派生「即前方加」「其方即…去/加」。
 */
export function extractZhongxiSectionFormulas(raw: string): WenbingFormulaBlock[] {
  const sections = splitWikiSections(raw)
  const blocks: WenbingFormulaBlock[] = []
  const seen = new Set<string>()
  let previousNamed: string | undefined

  const push = (block: WenbingFormulaBlock) => {
    if (!block.name || seen.has(block.name)) return
    if (block.herbs.length < 1 && !block.baseName) return
    // 单味方：须有剂量（蒲公英汤：鲜蒲公英四两）
    if (block.herbs.length === 1 && !block.baseName) {
      const only = block.herbs[0]!
      if (!only.doseRaw && !only.note && !/[（(]/.test(only.rawText)) return
    }
    seen.add(block.name)
    blocks.push(block)
    previousNamed = block.name
  }

  for (const section of sections) {
    const name = normalizeZhongxiName(section.title)
    if (!/(?:汤|散|丸|膏|煎|饮|丹)$/.test(name)) continue
    if (name.length < 2 || name.length > 16) continue
    // 论说文标题：「论吴又可达原饮不可以治温病」
    if (/^论|不可以|不可用|不宜/.test(name)) continue
    // 石膏粳米汤等含「膏」词干：允许剂型尾仍过长的常用方名
    if (!isPlausibleFormulaName(name) && !/煎$|石膏/.test(name)) continue

    const bodyLines = section.body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)

    let derived: WenbingFormulaBlock | null = null
    for (const line of bodyLines.slice(0, 8)) {
      derived = parseDerivedZhongxiLine(line)
      if (derived) break
    }
    if (derived) {
      const baseName =
        derived.baseName === '__PREV__' ? previousNamed : derived.baseName
      if (baseName) {
        push({
          name,
          herbs: derived.herbs,
          preparation: '',
          baseName,
          removeNames: derived.removeNames,
        })
        continue
      }
    }

    // 「此方减…名健运丸」挂在健运汤节：由括号块处理；本节直接抽药列
    const doseLines = collectDoseLines(section.body)
    if (doseLines.length === 0) continue
    let herbs = parseHerbLines(doseLines)
    // 单味长括注兜底：鲜蒲公英（四两，…）
    if (herbs.length < 1) {
      const single = section.body.match(
        /([\u4e00-\u9fff]{2,8})[（(]([一二三四五六七八九十百半]+[两钱分厘])[^）)]*[）)]/,
      )
      if (single) {
        herbs = [
          {
            herbId: single[1]!,
            name: single[1]!,
            rawText: single[0]!,
            doseRaw: single[2]!,
          },
        ]
      }
    }
    if (herbs.length === 0) continue
    if (herbs.length === 1 && !herbs[0]!.doseRaw && !herbs[0]!.note) continue
    push({ name, herbs, preparation: '' })
  }

  const text = toSimplifiedChinese(cleanWikiBody(raw)).replace(/\r\n/g, '\n')

  // 【建瓴汤】/【补脑振痿汤】括注药列（方名后或有治证句，药列在其后）
  const bracketRe = /【([\u4e00-\u9fff]{2,16}(?:汤|散|丸|膏|煎|饮|丹))】/g
  let match: RegExpExecArray | null
  while ((match = bracketRe.exec(text)) !== null) {
    const name = match[1]!
    if (seen.has(name)) continue
    if (!isPlausibleFormulaName(name) && !/石膏/.test(name)) continue
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 420)
    const stop = after.search(/\n(?:'''|【|={2,}|共药|此方于|方中|轻证|若脉)/)
    const window = stop > 0 ? after.slice(0, stop) : after
    const doseLines = collectDoseLines(window, 10)
    const herbs =
      doseLines.length > 0
        ? parseHerbLines(doseLines)
        : parseHerbLines([window.replace(/\n+/g, ' ').split(/[。；]/)[0] ?? ''])
    if (herbs.length < 2) continue
    push({ name, herbs, preparation: '' })
  }

  // 犀黄丸，用乳香、没药末各一两…
  const proseRe =
    /(?:^|[\n。；）)])([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮|丹))[，,]用([\u4e00-\u9fff、，,各一两钱分厘升合枚末半牛研细共\s]{8,160})/g
  while ((match = proseRe.exec(text)) !== null) {
    const name = match[1]!
    if (seen.has(name)) continue
    if (!isPlausibleFormulaName(name)) continue
    const herbs = parseHerbLines([match[2]!.split(/[。；]|共研|取黄/)[0]!])
    if (herbs.length < 2) continue
    push({ name, herbs, preparation: '' })
  }

  // 曼陀罗熬膏：原文「再加入硼砂…再用远志…甘草…石膏…」
  if (!seen.has('曼陀罗熬膏')) {
    const mandala = text.match(
      /曼陀罗正开花时[\s\S]{0,80}?再加入硼砂([一二三四五六七八九十两]+)?[\s\S]{0,60}?再用远志细末、甘草细末各([一二三四五六七八九十两]+)?[\s\S]{0,40}?生石膏细末([一二三四五六七八九十两]+)?/,
    )
    if (mandala) {
      push({
        name: '曼陀罗熬膏',
        herbs: [
          { herbId: '曼陀罗', name: '曼陀罗', rawText: '曼陀罗原汁', doseRaw: '四两' },
          {
            herbId: '硼砂',
            name: '硼砂',
            rawText: `硼砂${mandala[1] ?? '二两'}`,
            doseRaw: mandala[1] ?? '二两',
          },
          {
            herbId: '远志',
            name: '远志',
            rawText: `远志细末各${mandala[2] ?? '四两'}`,
            doseRaw: mandala[2] ?? '四两',
          },
          {
            herbId: '甘草',
            name: '甘草',
            rawText: `甘草细末各${mandala[2] ?? '四两'}`,
            doseRaw: mandala[2] ?? '四两',
          },
          {
            herbId: '石膏',
            name: '石膏',
            rawText: `生石膏细末${mandala[3] ?? '六两'}`,
            doseRaw: mandala[3] ?? '六两',
          },
        ],
        preparation: '和膏为丸',
      })
    }
  }

  // 解毒活血汤：紧随「宜用解毒活血汤。」后的括注药列
  if (!seen.has('解毒活血汤')) {
    const detox = text.match(
      /宜用解毒活血汤。\s*([\u4e00-\u9fff（）()两钱分厘、\s]{20,220}?)(?:轻证|危证|或热)/,
    )
    if (detox) {
      const herbs = parseHerbLines([detox[1]!.replace(/\n+/g, ' ')])
      if (herbs.length >= 4) push({ name: '解毒活血汤', herbs, preparation: '' })
    }
  }

  // 健运丸：健运汤节「此方减麦冬、知母三分之一…名健运丸」
  if (!seen.has('健运丸') && seen.has('健运汤')) {
    const jianyun = blocks.find((b) => b.name === '健运汤')
    if (jianyun && /此方减麦冬、知母/.test(text)) {
      push({
        name: '健运丸',
        herbs: jianyun.herbs.map((h) => ({ ...h })),
        preparation: '轧细炼蜜为丸',
      })
    }
  }

  return blocks
}

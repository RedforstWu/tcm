import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import { extractFormulaBlocks, isFormulaNameLine, isPreparationLine } from '../lib/formula-parse.ts'
import { fileExists, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { cleanWikiMarkup, extractChapters, normalizeForCompare, toSimplifiedChinese } from '../lib/wiki.ts'

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
  for (const name of ['太阳', '阳明', '少阳', '太阴', '少阴', '厥阴', '霍乱']) {
    if (chapter.includes(name)) return [name]
  }
  return []
}

function extractLeadingFormulaMentions(clauseText: string): string[] {
  const text = toSimplifiedChinese(clauseText)
  const names = new Set<string>()
  const re = /([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))(?:主之|方|。|$|，)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) names.add(match[1]!)
  const yi = text.match(/宜([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))/)
  if (yi?.[1]) names.add(yi[1])
  return [...names]
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
  }
}

export function parseSongbenWiki(raw: string): {
  clauses: Clause[]
  formulas: Formula[]
  numberedClauseTexts: string[]
} {
  const cleaned = cleanWikiMarkup(raw)
  const chapters = extractChapters(cleaned)
  const clauses: Clause[] = []
  const formulas: Formula[] = []
  const formulaByName = new Map<string, Formula>()
  let chapterOrder = 0
  let clauseOrder = 0
  const numberedClauseTexts: string[] = []
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
    }

    // 宋本维基：一条一自然段/一行
    const lines = simplifiedBody
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)

    for (const rawLine of lines) {
      // 去掉条首数目（如「一五八」「第158条」）与校注残句
      let line = rawLine
        .replace(/^[一二三四五六七八九十百零〇]+、?/, '')
        .replace(/^第?\d+条?/, '')
        .trim()
      if (/本云|同体别名|疑非|见《/.test(line) && !/主之|宜/.test(line)) continue
      if (shouldSkipLine(line)) continue
      clauseOrder += 1
      const id = `songben-${clauseOrder}`
      const mentioned = extractLeadingFormulaMentions(line)
      const formulaIds: string[] = []
      for (const name of mentioned) {
        const formula = formulaByName.get(name)
        if (!formula) continue
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
        pathogenesisTags: [],
        reviewStatus: 'ai-draft',
      })
      numberedClauseTexts.push(line)
    }
  }

  return { clauses, formulas, numberedClauseTexts }
}

export async function runSongbenParse(): Promise<SongbenParseResult> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data/raw/songben-shanghan.wiki'))
  const parsed = parseSongbenWiki(raw)
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
      expected: 398,
      huxishuMatched: matched,
      huxishuTotal: openings.length,
      mismatches,
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

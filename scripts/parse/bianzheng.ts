import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import { extractChenfuFormulaBlocks } from '../lib/chenfu-formula.ts'
import {
  buildHerbLexicon,
  extractBencaoHerbNames,
} from '../lib/herb-lexicon.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'

function extractMisjudgment(text: string): Clause['misjudgment'] | undefined {
  const simplified = toSimplifiedChinese(text)
  const match = simplified.match(
    /人以为([^，。；]{2,40})[，,]?\s*谁知([^。]{2,80})/,
  )
  if (!match) return undefined
  return {
    commonView: match[1]!.trim(),
    trueView: match[2]!.replace(/[乎耶哉].*$/, '').trim(),
  }
}

/**
 * 《辨证录》结构：== 卷之一 == / === 伤寒门（四十三则） ===
 * 门内无编号标题，以病情叙述段落起则，方用∶ 分段。
 */
export async function runBianzhengParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: { chapterCount: number; clauseCount: number; formulaCount: number }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', 'bianzheng-lu.wiki'))
  let bencaoNames: string[] = []
  try {
    const bencao = await readText(path.join(root, 'data', 'raw', 'bencao-xinbian.wiki'))
    bencaoNames = extractBencaoHerbNames(bencao)
  } catch {
    bencaoNames = []
  }
  const lexicon = buildHerbLexicon(bencaoNames)
  const text = toSimplifiedChinese(raw)

  const clauses: Clause[] = []
  const formulas: Formula[] = []

  // 切门
  const doorRe = /^===\s*(.+?门[^=\n]*)\s*===\s*$/gm
  const doors: Array<{ title: string; index: number }> = []
  let match: RegExpExecArray | null
  while ((match = doorRe.exec(text)) !== null) {
    doors.push({ title: match[1]!.trim(), index: match.index + match[0].length })
  }

  // 卷
  const juanRe = /^==\s*(卷[^=\n]*)\s*==\s*$/gm
  const juans: Array<{ title: string; index: number }> = []
  while ((match = juanRe.exec(text)) !== null) {
    juans.push({ title: match[1]!.trim(), index: match.index })
  }

  function juanAt(pos: number): string {
    let title = '卷'
    for (const juan of juans) {
      if (juan.index <= pos) title = juan.title
    }
    return title
  }

  /** 在一门内按「方用」块回溯切则 */
  function splitCases(body: string): string[] {
    // 以「方用」为锚，向前找到病情起句
    const fangYongPositions: number[] = []
    const fyRe = /(?:^|\n)方用/g
    let fy: RegExpExecArray | null
    while ((fy = fyRe.exec(body)) !== null) {
      fangYongPositions.push(fy.index)
    }
    if (fangYongPositions.length === 0) return body.trim() ? [body.trim()] : []

    const cases: string[] = []
    for (let i = 0; i < fangYongPositions.length; i += 1) {
      const fangPos = fangYongPositions[i]!
      // 找本则起点：上一则结束后 或 病情起句
      const prevEnd = i === 0 ? 0 : fangYongPositions[i - 1]!
      // 从 prevEnd 到 fangPos 之间找最后一个「长叙述」起点
      const before = body.slice(prevEnd, fangPos)
      // 下一则起点：下一个方用之前的叙述可能属于本则（备选方）
      // 简化：从本次方用往前找段落，合并到下一个「明显新起句」之前的所有方用
    }
    void cases

    // 更稳妥：按「双换行 + 非方用起句的长段」切
    // 辨证录则与则之间常无空行，用「方用」组：主方+备选方同属一则
    const units: string[] = []
    let cursor = 0
    for (let i = 0; i < fangYongPositions.length; i += 1) {
      const pos = fangYongPositions[i]!
      // 窥探方用前文本是否像新则起句
      const prelude = body.slice(cursor, pos).trim()
      const nextFang = i + 1 < fangYongPositions.length ? fangYongPositions[i + 1]! : body.length
      // 检查下一个方用之前是否有「亦可用」类，若有则合并
      let end = nextFang
      // 合并连续备选：若下一片段的 prelude 很短且含亦可，并入
      while (i + 1 < fangYongPositions.length) {
        const between = body.slice(fangYongPositions[i]!, fangYongPositions[i + 1]!).trim()
        const followingPrelude = body
          .slice(
            body.indexOf('\n', fangYongPositions[i]!) + 1,
            fangYongPositions[i + 1]!,
          )
          .trim()
        // 若 between 含「亦可用/亦佳/并载」且长度不太大，合并下一张方
        if (/亦可用|亦佳|并载|备选用|此病用/.test(between) && between.length < 2500) {
          i += 1
          end = i + 1 < fangYongPositions.length ? fangYongPositions[i + 1]! : body.length
          void followingPrelude
          continue
        }
        break
      }
      const chunk = (prelude + '\n' + body.slice(pos, end)).trim()
      if (chunk.length > 30) units.push(chunk)
      cursor = end
    }
    return units
  }

  for (let di = 0; di < doors.length; di += 1) {
    const door = doors[di]!
    const doorEnd = di + 1 < doors.length ? doors[di + 1]!.index : text.length
    // 去掉下一门标题前的内容
    let doorBody = text.slice(door.index, doorEnd)
    // 截到下一个 == 卷
    const nextJuan = doorBody.search(/\n==\s*卷/)
    if (nextJuan > 0) doorBody = doorBody.slice(0, nextJuan)

    const doorTitle = door.title.replace(/（[^）]+）/g, '').trim()
    const juan = juanAt(door.index)
    const cases = splitCases(doorBody)

    for (let ci = 0; ci < cases.length; ci += 1) {
      const body = cases[ci]!
      const clauseId = `bianzheng-${String(clauses.length + 1).padStart(4, '0')}`
      const blocks = extractChenfuFormulaBlocks(body, {
        anonymousPrefix: `${doorTitle}·第${ci + 1}则`,
        lexicon,
      })
      const formulaIds: string[] = []
      let mainFormulaId: string | undefined
      for (let fi = 0; fi < blocks.length; fi += 1) {
        const block = blocks[fi]!
        const formulaId = `bianzheng-formula-${clauseId}-${fi + 1}`
        if (fi === 0) mainFormulaId = formulaId
        formulaIds.push(formulaId)
        formulas.push({
          id: formulaId,
          name: block.name,
          book: 'bianzheng',
          herbs: block.herbs,
          preparation: block.preparation,
          modifications: [],
          sourceClauseIds: [clauseId],
          chapter: `${juan}·${doorTitle}`,
          doseSystem: 'qing',
          role: block.role,
          alternateOf: block.role === 'alternate' ? mainFormulaId : undefined,
          derivedFrom: block.derivedFrom,
          fangjie: block.fangjie,
          anonymous: block.anonymous,
        })
      }

      clauses.push({
        id: clauseId,
        book: 'bianzheng',
        chapter: `${juan}·${doorTitle}`,
        chapterOrder: di + 1,
        order: ci + 1,
        text: body.slice(0, 2000),
        formulaIds,
        symptomTags: [],
        pulseTags: [],
        channelTags: [],
        pathogenesisTags: [],
        reviewStatus: 'ai-draft',
        heading: `${doorTitle}·第${ci + 1}则`,
        misjudgment: extractMisjudgment(body),
      })
    }
  }

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, 'bianzheng.json'), { clauses, formulas })

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: doors.length,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
    },
  }
}

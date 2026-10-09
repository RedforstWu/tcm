import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Formula } from '../../src/types/data.ts'
import { normalizeHerbNameForCompare, resolveKnownHerbName } from '../lib/herb-lexicon.ts'
import { projectRoot } from '../lib/fs-utils.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'
import {
  formatJinguiParseSummary,
  normalizeJinguiFormulaHeaders,
  parseJinguiWiki,
} from './jingui.ts'

/** 以维基文库原文片段（繁体 + wiki 标记）拼出一篇最小文本 */
function wikiChapter(title: string, lines: string[]): string {
  return [`== ${title} ==`, ...lines].join('\n')
}

function herbNames(formula: Formula | undefined): string[] {
  return (formula?.herbs ?? []).map((herb) => herb.name)
}

function findFormula(formulas: Formula[], name: string): Formula | undefined {
  return formulas.find((formula) => formula.name === name)
}

describe('jingui 方剂边界（越界吞并后文）', () => {
  it('「方名：主治」标题行结束上一方：乌头汤不吞并矾石汤', () => {
    const { formulas, clauses } = parseJinguiWiki(
      wikiChapter('中風歷節病脈證並治第五', [
        '病歷節不可屈伸，疼痛，烏頭湯主之。',
        '',
        ":'''烏頭湯方：'''治腳氣疼痛，不可屈伸。",
        '::麻黃　芍藥　黃耆各三兩　甘草三兩（炙）　川烏五枚㕮咀，以蜜二升，煎取一升，即出烏頭）',
        '::上五味，㕮咀四味，以水三升，煮取一升，去滓，內蜜煎中，更煎之，服七合。不知，盡服之。',
        '',
        ":'''礬石湯：'''治腳氣衝心。",
        '::礬石二兩',
        '::上一味，以漿水一斗五升，煎三五沸，浸腳良。',
      ]),
    )
    const wutou = findFormula(formulas, '乌头汤')
    expect(herbNames(wutou)).toEqual(['麻黄', '芍药', '黄芪', '甘草', '川乌'])
    expect(wutou?.herbs.find((herb) => herb.name === '川乌')?.doseRaw).toBe('五枚')
    expect(wutou?.preparation).not.toContain('浆水')
    expect(herbNames(findFormula(formulas, '矾石汤'))).toEqual(['矾石'])
    // 主治行留在条文流，药味 / 煎服法行不再混入条文
    const clauseText = clauses.map((clause) => clause.text).join('')
    expect(clauseText).toContain('矾石汤：治脚气冲心。')
    expect(clauseText).not.toContain('川乌五枚')
  })

  it('空行之后的下一方标题不被并入煎服法：赤石脂丸 / 九痛丸', () => {
    const { formulas } = parseJinguiWiki(
      wikiChapter('胸痹心痛短氣病脈證治第九', [
        '心痛徹背，背痛徹心，烏頭赤石脂丸主之。',
        '',
        '赤石脂丸方：',
        '',
        '蜀椒一兩，一法二分；烏頭一分，炮；附子半兩，炮，一法一分；乾姜一兩，一法一分；赤石脂一兩，一法二分。',
        '',
        '右五味，末之，蜜丸如梧子大，先食服一丸，日三服。',
        '',
        '九痛丸：治九種心痛。',
        ' ',
        '附子三兩，炮；生狼牙一兩，炙香；巴豆一兩，去皮、心，熬，研如脂；人參、乾姜、吳茱萸各一兩。',
        '',
        '右六味，沫之，煉蜜丸如梧子大，酒下，強人初服三丸，日三服；弱者二丸。兼治卒中惡，腹脹痛，口不能言。又治連年積冷，流注心胸痛，并冷腫上氣，落馬墜車血疾等，皆主之。忌口如常法。',
      ]),
    )
    const chishizhi = findFormula(formulas, '赤石脂丸')
    expect(herbNames(chishizhi)).toEqual(['花椒', '乌头', '附子', '干姜', '赤石脂'])
    expect(chishizhi?.preparation).not.toContain('九痛')
    const jiutong = findFormula(formulas, '九痛丸')
    expect(herbNames(jiutong)).toEqual(['附子', '生狼牙', '巴豆', '人参', '干姜', '吴茱萸'])
    // 「……皆主之」是煎服法里的话，不应截断煎服法
    expect(jiutong?.preparation).toContain('忌口如常法')
  })

  it('无方名单方「救卒死方」结束上一方的煎服法', () => {
    const { formulas, stats } = parseJinguiWiki(
      wikiChapter('雜療方第二十三', [
        '治傷寒令愈不復，紫石寒食散方：{{*|見《千金翼》。}}',
        '紫石英　白石英　赤石脂　鐘乳研煉　栝蔞根　防風　桔梗　文蛤　鬼臼各十分　太乙餘糧十分燒　乾薑　附子炮去皮　桂枝去皮各四分',
        '',
        '上十三味，杵為散，酒服方寸匕。',
        '救卒死方：',
        '薤搗汁，灌鼻中。',
      ]),
    )
    const zishi = findFormula(formulas, '紫石寒食散')
    expect(zishi?.herbs).toHaveLength(13)
    expect(herbNames(zishi)).toEqual(
      expect.arrayContaining(['钟乳', '鬼臼', '太乙余粮', '附子', '桂枝']),
    )
    expect(zishi?.preparation).toBe('上十三味，杵为散，酒服方寸匕。')
    expect(stats.unresolvedHerbTokenCount).toBe(0)
  })
})

describe('jingui 组成行未识别（空药味 / 漏方）', () => {
  it('识别「《千金》方名：主治」标题与「；」分隔的药味行', () => {
    const { formulas } = parseJinguiWiki(
      wikiChapter('肺痿肺癰咳嗽上氣病脈證治第七', [
        '《千金》桂枝去芍藥加皂莢湯：治肺痿吐涎沫。',
        '',
        '桂枝、生姜各三兩；甘草二兩；大棗十枚；皂莢二枚，去皮子，炙焦。',
        '',
        '右五味，以水七升，微微大煮取三升，分溫三服。',
      ]),
    )
    const formula = findFormula(formulas, '桂枝去芍药加皂荚汤')
    expect(herbNames(formula)).toEqual(['桂枝', '生姜', '甘草', '大枣', '皂荚'])
    expect(formula?.herbs.find((herb) => herb.name === '生姜')?.doseRaw).toBe('三两')
  })

  it('附方小节并回主篇；「獭肝一具」按量词回收为獭肝', () => {
    const { formulas, stats } = parseJinguiWiki(
      [
        '== 血痹虛勞病脈證並治第六 ==',
        ':;大黃䗪蟲丸方：',
        '::大黃十分（蒸）　黃芩二兩　甘草三兩　桃仁一升　杏仁一升　芍藥四兩　乾地黃十兩　乾漆一兩　虻蟲一升　水蛭百枚　蠐螬一升　䗪蟲半升',
        '::上十二味，末之，煉蜜和丸小豆大，酒飲服五丸，日三服。',
        '',
        '=== 【附方】 ===',
        ":'''《肘後》獺肝散：'''治冷勞，又主鬼疰一門相染。",
        '::獺肝一具',
        '::炙乾末之，水服方寸匕，日三服。',
      ].join('\n'),
    )
    const dahuang = findFormula(formulas, '大黄䗪虫丸')
    expect(dahuang?.herbs).toHaveLength(12)
    expect(herbNames(dahuang)).toContain('䗪虫')
    const tagan = findFormula(formulas, '獭肝散')
    expect(herbNames(tagan)).toEqual(['獭肝'])
    expect(tagan?.herbs[0]?.doseRaw).toBe('一具')
    expect(stats.emptyHerbFormulaCount).toBe(0)
  })
})

describe('jingui 注语 / 炮制语被当成药名', () => {
  it('「蜘蛛十四枚，熬焦；」的熬焦并入炮制', () => {
    const { formulas } = parseJinguiWiki(
      wikiChapter('跗蹶手指臂腫轉筋陰狐疝蚘蟲病脈證治第十九', [
        '陰狐疝氣者，偏有小大，時時上下，蜘蛛散主之。',
        '',
        '蜘蛛散方*：',
        '',
        '蜘蛛十四枚，熬焦；桂枝半兩。',
        '',
        '右二味，為散，取八分一匕，飲和服，日再服，蜜丸亦可。',
      ]),
    )
    const formula = findFormula(formulas, '蜘蛛散')
    expect(herbNames(formula)).toEqual(['蜘蛛', '桂枝'])
    expect(formula?.herbs[0]?.processing).toMatch(/熬/)
    expect(formula?.herbs[0]?.doseRaw).toBe('十四枚')
  })

  it('药名必须可解析：加减语进入 unresolvedHerbTokens，不进 herbs', () => {
    const { formulas, stats } = parseJinguiWiki(
      wikiChapter('雜療方第二十三', [
        '退五臟虛熱，四時加減柴胡飲子方：',
        '冬三月加柴胡八分　白朮八分　陳皮五分　大腹檳榔四枚並皮子用　生薑五分　桔梗七分　春三月加枳實　減白朮共六味　夏三月加生薑三分　枳實五分　甘草三分共八味　秋三月加陳皮三分共六味',
        '',
        '右各㕮咀，分為三貼，一貼以水三升，煮取二升，分溫三服。',
      ]),
    )
    const formula = findFormula(formulas, '四时加减柴胡饮子')
    expect(formula).toBeDefined()
    for (const name of herbNames(formula)) expect(resolveKnownHerbName(name)).toBe(name)
    expect(herbNames(formula)).toEqual(expect.arrayContaining(['白术', '陈皮', '桔梗', '枳实', '甘草']))
    const unresolved = stats.unresolvedHerbTokens['四时加减柴胡饮子'] ?? []
    expect(unresolved).toContain('减白术共六味')
    expect(unresolved).not.toContain('退五脏虚热')
    expect(formatJinguiParseSummary(stats)).toContain('四时加减柴胡饮子')
  })
})

describe('jingui 正常方剂不受影响', () => {
  it('桂枝芍药知母汤：九味与剂量完整，后续条文仍入条文流', () => {
    const { formulas, clauses } = parseJinguiWiki(
      wikiChapter('中風歷節病脈證並治第五', [
        '諸肢節疼痛，身體魁羸，腳腫如脫，頭眩短氣，溫溫欲吐，桂枝芍藥知母湯主之。',
        '',
        ':;桂枝芍藥知母湯方：',
        '::桂枝四兩　芍藥三兩　甘草二兩　麻黃二兩　生薑五兩　白朮五兩　知母四兩　防風四兩　附子二枚（炮）',
        '::上九味，以水七升，煮取二升，溫服七合，日三服。',
        '',
        '味酸則傷筋，筋傷則緩，名曰泄。',
      ]),
    )
    const formula = findFormula(formulas, '桂枝芍药知母汤')
    expect(formula?.herbs.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual([
      '桂枝:四两',
      '芍药:三两',
      '甘草:二两',
      '麻黄:二两',
      '生姜:五两',
      '白术:五两',
      '知母:四两',
      '防风:四两',
      '附子:二枚',
    ])
    expect(formula?.preparation).toBe('上九味，以水七升，煮取二升，温服七合，日三服。')
    expect(formula?.sourceClauseIds).toHaveLength(1)
    expect(clauses.map((clause) => clause.text).join('')).toContain('味酸则伤筋')
  })

  it('normalizeJinguiFormulaHeaders 拆分三种标题形态', () => {
    const normalized = normalizeJinguiFormulaHeaders(
      ['矾石汤：治脚气冲心。', '治伤寒令愈不复，紫石寒食散方', '附方：', '蛇床子散方，温阴中坐药。'].join(
        '\n',
      ),
    )
    expect(normalized.split('\n')).toEqual([
      '矾石汤方',
      '治脚气冲心。',
      '',
      '紫石寒食散方',
      '治伤寒令愈不复',
      '',
      '蛇床子散方',
      '温阴中坐药。',
    ])
  })
})

// ---------------- KB 比对（vendor 目录缺失时跳过） ----------------

const KB_FORMULA_DIR = path.join(
  projectRoot(),
  'data/vendor/shanghan-lun-knowledge-base/伤寒论知识库/02_方剂',
)
const JINGUI_RAW_PATH = path.join(projectRoot(), 'data/raw/jingui-yaolue.wiki')
const REPORT_PATH = path.join(projectRoot(), 'data/integration/reports/jingui-formula-check.json')
const KB_SOURCE_PREFIX = '金匮要略'

/** KB 方名 → 维基文库原文方名（KB 用通行名 / 有讹字） */
const KB_TO_LOCAL_FORMULA_NAME: Record<string, string> = {
  暮蓣丸: '薯蓣丸',
  乌头赤石脂丸: '赤石脂丸',
  乌梅丸: '鸟梅丸',
  甘草干姜茯苓白术汤: '甘姜苓术汤',
  甘草小麦大枣汤: '甘麦大枣汤',
  木防己去石膏加茯苓芒硝汤: '木防己汤去石膏加茯苓芒硝汤',
}
/** KB 侧丢字或异写，与本地规范名等价（只用于判定 naming-only，不改 lexicon） */
const KB_NAMING_EQUIVALENTS: Record<string, string> = {
  虫: '䗪虫',
  石韦: '石苇',
  蜂巢: '蜂窝',
  冬瓜子: '瓜子',
}
/** 人工核对原文后的判定（verdict 依据原文，不依据 KB） */
const MANUAL_VERDICTS: Record<string, { verdict: Verdict; note: string }> = {
  乌头汤: {
    verdict: 'kb-error',
    note: '原文「川乌五枚（㕮咀，以蜜二升，煎取一升，即出乌头）」「上五味」：蜜是煎乌头的辅料，不计入五味；KB 把蜜列入组成。',
  },
  排脓散: {
    verdict: 'kb-error',
    note: '原文「枳实十六枚，芍药六分，桔梗一分」「右三味，杵为散，取鸡子黄一枚，以药散与鸡黄相等，揉和」：鸡子黄为服法调和之物，不在三味之内。',
  },
  暮蓣丸: {
    verdict: 'needs-review',
    note: 'KB 方名「暮蓣丸」为「薯蓣丸」之讹。原文作「当归 桂枝 条 干地黄 豆黄卷各十分」「上二十一味」，本地只得二十味：单字「条」不是药名，疑为「曲」之讹（KB 作曲），需对校他本后再决定是否在 lexicon 补讹字。',
  },
}

type Verdict = 'local-fixed' | 'kb-error' | 'naming-only' | 'needs-review'

interface KbFormula {
  name: string
  source: string
  herbs: string[]
}

interface DifferEntry {
  name: string
  kbOnly: string[]
  localOnly: string[]
  verdict: Verdict
  note: string
}

function readKbJinguiFormulas(directory: string): KbFormula[] {
  const result: KbFormula[] = []
  for (const fileName of readdirSync(directory)) {
    if (!fileName.endsWith('.md')) continue
    const frontmatter = readFileSync(path.join(directory, fileName), 'utf8').split('---')[1] ?? ''
    const field = (key: string) =>
      frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
    const source = field('出处')
    if (!source.startsWith(KB_SOURCE_PREFIX)) continue
    const herbs = field('组成')
      .replace(/^\[|\]$/g, '')
      .split(/[,，]/)
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
    result.push({ name: field('方名'), source, herbs })
  }
  return result.sort((left, right) => left.name.localeCompare(right.name, 'zh'))
}

function localNameCandidates(kbName: string): string[] {
  const aliased = KB_TO_LOCAL_FORMULA_NAME[kbName]
  return [kbName, aliased, kbName.replace(/芪/g, '耆')].filter(
    (candidate): candidate is string => Boolean(candidate),
  )
}

function findLocalFormula(formulas: Formula[], kbName: string): Formula | undefined {
  for (const candidate of localNameCandidates(kbName)) {
    const formula = findFormula(formulas, candidate)
    if (formula) return formula
  }
  return undefined
}

function diffHerbSets(kbHerbs: string[], localHerbs: string[]) {
  const kbSet = [...new Set(kbHerbs.map(normalizeHerbNameForCompare))]
  const localSet = [...new Set(localHerbs.map(normalizeHerbNameForCompare))]
  return {
    kbOnly: kbSet.filter((name) => !localSet.includes(name)),
    localOnly: localSet.filter((name) => !kbSet.includes(name)),
  }
}

function formulaEvidence(formula: Formula): string {
  const herbText = formula.herbs.map((herb) => herb.rawText).join(' ')
  return `原文组成「${herbText}」；煎服法「${formula.preparation.slice(0, 24)}」`
}

function judgeDifference(
  name: string,
  kbOnly: string[],
  localOnly: string[],
  formula: Formula,
): { verdict: Verdict; note: string } {
  const manual = MANUAL_VERDICTS[name]
  if (manual) return manual
  const mappedKbOnly = kbOnly.map((herb) => KB_NAMING_EQUIVALENTS[herb] ?? herb)
  const remainingKb = mappedKbOnly.filter((herb) => !localOnly.includes(herb))
  const remainingLocal = localOnly.filter((herb) => !mappedKbOnly.includes(herb))
  if (remainingKb.length === 0 && remainingLocal.length === 0) {
    const pairs = kbOnly.map((herb) => `KB「${herb}」=原文「${KB_NAMING_EQUIVALENTS[herb] ?? herb}」`)
    return { verdict: 'naming-only', note: `${pairs.join('，')}。${formulaEvidence(formula)}` }
  }
  const statedCount = formula.preparation.match(/^(?:上|右)([一二三四五六七八九十]+)味/)?.[1]
  return {
    verdict: 'needs-review',
    note: `KB 多「${remainingKb.join('、')}」，本地多「${remainingLocal.join('、')}」${
      statedCount ? `；原文「${statedCount}味」` : ''
    }。${formulaEvidence(formula)}`,
  }
}

function buildJinguiFormulaCheck(
  kbFormulas: KbFormula[],
  localFormulas: Formula[],
  baselineFormulas: Formula[] | null,
  simplifiedRaw: string,
) {
  const differ: DifferEntry[] = []
  const notFound: Array<{ name: string; note: string }> = []
  const recovered: string[] = []
  let compared = 0
  let equal = 0
  for (const kbFormula of kbFormulas) {
    const local = findLocalFormula(localFormulas, kbFormula.name)
    if (!local) {
      const mentionedName = localNameCandidates(kbFormula.name).find((candidate) =>
        simplifiedRaw.includes(candidate),
      )
      notFound.push({
        name: kbFormula.name,
        note: mentionedName
          ? `维基文库原文只在条文中出现「${mentionedName}」，未以药味行载组成`
          : '维基文库原文未见此方名',
      })
      continue
    }
    compared += 1
    const localHerbs = local.herbs.map((herb) => herb.name)
    const { kbOnly, localOnly } = diffHerbSets(kbFormula.herbs, localHerbs)
    const baseline = baselineFormulas ? findLocalFormula(baselineFormulas, kbFormula.name) : undefined
    const baselineDiff = baseline
      ? diffHerbSets(kbFormula.herbs, baseline.herbs.map((herb) => herb.name))
      : null
    if (kbOnly.length === 0 && localOnly.length === 0) {
      equal += 1
      if (baselineFormulas && !baseline) recovered.push(local.name)
      if (baselineDiff && baselineDiff.kbOnly.length + baselineDiff.localOnly.length > 0) {
        differ.push({
          name: kbFormula.name,
          kbOnly: baselineDiff.kbOnly,
          localOnly: baselineDiff.localOnly,
          verdict: 'local-fixed',
          note: `修复前本地与 KB 不一致，修复后一致。${formulaEvidence(local)}`,
        })
      }
      continue
    }
    const judged = judgeDifference(kbFormula.name, kbOnly, localOnly, local)
    const baselineChanged =
      baselineDiff &&
      (baselineDiff.kbOnly.join('、') !== kbOnly.join('、') ||
        baselineDiff.localOnly.join('、') !== localOnly.join('、'))
    const baselineNote = baselineChanged
      ? `（修复前：KB 多「${baselineDiff.kbOnly.join('、')}」，本地多「${baselineDiff.localOnly.join('、')}」）`
      : ''
    differ.push({ name: kbFormula.name, kbOnly, localOnly, ...judged, note: `${judged.note}${baselineNote}` })
  }
  return { compared, equal, differ, notFound, recovered }
}

function readOptionalJson(filePath: string | undefined): unknown {
  if (!filePath || !existsSync(filePath)) return null
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

describe.skipIf(!existsSync(KB_FORMULA_DIR))('jingui 与 KB 方剂比对', () => {
  it('按方名比对药味集合，并给出 verdict', () => {
    const raw = readFileSync(JINGUI_RAW_PATH, 'utf8')
    const { formulas, stats } = parseJinguiWiki(raw)
    const kbFormulas = readKbJinguiFormulas(KB_FORMULA_DIR)
    expect(kbFormulas.length).toBeGreaterThan(0)

    // 可选：修复前的 jingui.json，用于判定 local-fixed
    const baseline = readOptionalJson(process.env.JINGUI_CHECK_BASELINE) as {
      formulas: Formula[]
    } | null
    const check = buildJinguiFormulaCheck(
      kbFormulas,
      formulas,
      baseline?.formulas ?? null,
      toSimplifiedChinese(raw),
    )

    expect(check.compared + check.notFound.length).toBe(kbFormulas.length)
    for (const entry of check.differ) expect(entry.note.length).toBeGreaterThan(0)
    expect(check.differ.find((entry) => entry.name === '乌头汤')?.verdict).toBe('kb-error')
    expect(check.notFound.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['厚朴三物汤', '大半夏汤']),
    )
    expect(stats.emptyHerbFormulaCount).toBe(0)

    if (process.env.JINGUI_CHECK_WRITE === '1') {
      const verdictCounts: Record<string, number> = {}
      for (const entry of check.differ) {
        verdictCounts[entry.verdict] = (verdictCounts[entry.verdict] ?? 0) + 1
      }
      const report = {
        generatedAt: new Date().toISOString(),
        kbSourceFilter: `出处以「${KB_SOURCE_PREFIX}」开头`,
        kbFormulaCount: kbFormulas.length,
        compared: check.compared,
        equal: check.equal,
        verdictCounts,
        differ: check.differ,
        notFound: check.notFound,
        recoveredFormulas: check.recovered,
        notes: [
          '厚朴三物汤、大半夏汤在维基文库底本中只有「……主之」，没有组成行，jingui 解析不产出这两方；public/data 中这两方的空药味 / 注语药味来自 build-dataset 的空壳方与他书 donor 回填，不在 jingui 解析器内。',
          'verdict 依据维基文库原文：kb-error 表示 KB 把煎服法中的辅料计入组成；naming-only 表示 KB 丢字（䗪→虫）或异写（石韦/石苇、蜂巢/蜂窝、冬瓜子/瓜子）。',
        ],
        jinguiStats: {
          formulaCount: stats.formulaCount,
          emptyHerbFormulaCount: stats.emptyHerbFormulaCount,
          unresolvedHerbTokenCount: stats.unresolvedHerbTokenCount,
          unresolvedHerbTokens: stats.unresolvedHerbTokens,
        },
        // 可选：共用 formula-parse 对其他书的内存回归结果
        regression: readOptionalJson(process.env.JINGUI_CHECK_REGRESSION),
      }
      mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
      writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }
  })
})

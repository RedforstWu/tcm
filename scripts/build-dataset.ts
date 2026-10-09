import path from 'node:path'
import type {
  BookId,
  Clause,
  CrossLink,
  DatasetIndex,
  Formula,
  Herb,
  HerbMonograph,
  HerbRole,
  SearchDoc,
} from '../src/types/data.ts'
import { BOOK_CORPUS as CORPUS_MAP, JINGFANG_BOOKS } from '../src/types/data.ts'
import { alignChenfuParallels, alignSongbenToGuilin } from './lib/align.ts'
import { annotateClausesAsync } from './lib/annotate.ts'
import { loadBookRegistry } from './lib/books-registry.ts'
import {
  buildChenfuReasoningDataset,
  loadChenfuCaches,
  type CompareTopicInput,
} from './lib/chenfu-reasoning-build.ts'
import { extractHerbRolesFromFangjie } from './lib/fangjie.ts'
import { isNegatedFormulaMention, resolveMentionedFormulaName } from './lib/formula-mention.ts'
import { extractFormulaNames, isPlausibleFormulaName } from './lib/generic-wiki-parse.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'
import { buildGraphDataset } from './lib/graph-build.ts'
import { isKnownHerbName } from './lib/herb-lexicon.ts'
import {
  applyIntegrationToClauses,
  applyIntegrationToFormulas,
  backfillFormulaHerbs,
  countEvidenceLevelsByBook,
  gateClauseAttributes,
  gateCommentaries,
  gateSyndromes,
  loadIntegrationInputs,
  mergeEvidenceFiles,
  mergeSyndromeConcepts,
  publishModeLabel,
  resolvePublishGate,
  syndromeToConcept,
  type HerbBackfillPolicy,
} from './lib/integration-merge.ts'
import { PUBLISH_UNLICENSED_ENV } from './lib/integration-contract.ts'
import { runAllParsers } from './lib/parser-dispatch.ts'
import { computeDiffPairs, computeFamilies } from './lib/relations.ts'
import {
  buildReasoningDataset,
  type FormulaReasoningInput,
  type ReasoningTreeInput,
} from './lib/reasoning.ts'
import { collectUnmappedLabels, writeUnmappedReport } from './lib/concept-map.ts'
import { loadConceptLexicon, validateConceptLexicon } from './lib/concept-lexicon.ts'
import { rematchConceptIdsFromTags } from './lib/rematch-concepts.ts'

/** validation.json 中 id 清单的最大条数 */
const VALIDATION_SAMPLE_LIMIT = 200

/** 「当用煎方」「予亦定一煎方」「晚服丸方」等泛称，并非方名（须避开「桂枝二麻黄一汤」「安定汤」） */
const GENERIC_FORMULA_MENTION_RE =
  /(?:用|定一|服)(?:汤|散|丸|膏|煎|饮)$|大豆许|许三四丸|三四丸$/

/** 伤寒定本：条文习称 → 正名（勿建独立空壳再被千金同名异方灌药） */
const SHANGHAN_BOOKS = new Set(['songben', 'guilin', 'jingui'])
const SHANGHAN_MENTION_REMAP: Record<string, string> = {
  承气汤: '大承气汤',
  柴胡汤: '小柴胡汤',
}

function ensureMentionedFormulas(clauses: Clause[], formulas: Formula[]): Formula[] {
  const existing = new Set(formulas.map((formula) => `${formula.book}:${formula.name}`))
  const extras: Formula[] = []
  for (const clause of clauses) {
    // 仅保留「用/宜/服…方名」或「方名主之」语境，避免散文中「…散/…饮」误增方剂
    const names = extractFormulaNames(clause.text).filter((candidate) => {
      const idx = clause.text.indexOf(candidate)
      if (idx < 0) return false
      if (isNegatedFormulaMention(clause.text, idx)) return false
      const before = idx > 0 ? clause.text[idx - 1]! : ''
      const after = clause.text.slice(idx + candidate.length, idx + candidate.length + 2)
      return (
        /[用宜服与予投处名]/.test(before) ||
        after.startsWith('主之') ||
        after === '方'
      )
    })
    if (names.length === 0) continue
    for (const raw of names) {
      let name = resolveMentionedFormulaName(raw, clause.book, existing)
      if (SHANGHAN_BOOKS.has(clause.book) && SHANGHAN_MENTION_REMAP[name]) {
        name = SHANGHAN_MENTION_REMAP[name]!
      }
      name = canonicalFormulaName(name)
      if (GENERIC_FORMULA_MENTION_RE.test(name)) continue
      if (!isPlausibleFormulaName(name)) continue
      const key = `${clause.book}:${name}`
      if (existing.has(key)) {
        const formula = formulas.find((item) => item.book === clause.book && item.name === name)
        if (formula && !formula.sourceClauseIds.includes(clause.id)) {
          formula.sourceClauseIds.push(clause.id)
          if (!clause.formulaIds.includes(formula.id)) clause.formulaIds.push(formula.id)
        }
        continue
      }
      const id = `${clause.book}-formula-${name}`
      const formula: Formula = {
        id,
        name,
        book: clause.book,
        herbs: [],
        preparation: '',
        modifications: [],
        sourceClauseIds: [clause.id],
        chapter: clause.chapter,
      }
      extras.push(formula)
      existing.add(key)
      clause.formulaIds.push(id)
    }
  }
  return [...formulas, ...extras]
}

/**
 * 供药优先：经方定本 > 医宗金鉴方论 > 千金/外台。
 * 同名异方时，伤寒核心方以 songben/jingui/guilin 为准，避免千金异方污染。
 */
const FORMULA_HERB_DONOR_PRIORITY: Partial<Record<string, number>> = {
  songben: 120,
  jingui: 115,
  guilin: 110,
  yizong: 100,
  wenbing: 80,
  /** 衷中/温热：自拟方勿被辨证/石室同名异方覆盖 */
  zhongxi: 78,
  wenre: 76,
  jingyue: 75,
  xumingyi: 60,
  linzheng: 58,
  danxi: 56,
  bianzheng: 55,
  shishi: 50,
  qianjin: 40,
  waitai: 35,
}

const SHANGHAN_CORE_NAMES = new Set([
  '桂枝汤',
  '麻黄汤',
  '小柴胡汤',
  '大柴胡汤',
  '柴胡汤',
  '白虎汤',
  '四逆汤',
  '理中汤',
  '理中丸',
  '真武汤',
  '桃核承气汤',
  '桃仁承气汤',
  '大承气汤',
  '小承气汤',
  '调胃承气汤',
  '承气汤',
  '葛根汤',
  '五苓散',
  '泻心汤',
  '半夏泻心汤',
  '甘草泻心汤',
  '生姜泻心汤',
  '黄连汤',
  '黄芩汤',
  '麻黄杏仁甘草石膏汤',
  '小青龙汤',
  '大青龙汤',
  '柴胡桂枝汤',
  '炙甘草汤',
  '附子汤',
  '芍药甘草汤',
])

/**
 * 千金/外台同名异方（裸方名）：禁止向他书供药。
 * 伤寒「承气汤」尤禁灌入 songben/guilin/jingui。
 */
const QIANJIN_WAITAI_BOOKS = new Set(['qianjin', 'waitai'])
const QIANJIN_WAITAI_NO_CROSS_DONATE = new Set([
  '承气汤',
  '柴胡汤',
  '黄连丸',
  '温脾汤',
  '附子汤',
])

/** 他书习称 → 基准库正名（仅稳妥同方异名，不含随意「加味」） */
const FORMULA_NAME_ALIASES: Record<string, string> = {
  苓桂术甘汤: '茯苓桂枝白术甘草汤',
  复脉汤: '炙甘草汤',
  六味丸: '六味地黄丸',
  六味汤: '六味地黄丸',
  人参白虎汤: '白虎加人参汤',
  生脉汤: '生脉饮',
  加减生脉散: '生脉饮',
  通圣散: '防风通圣散',
  甘桔汤: '桔梗汤',
  地骨皮散: '地骨皮饮',
  双和散: '双和饮',
  三物小陷胸汤: '小陷胸汤',
  八味丸: '肾气丸',
  金匮肾气丸: '肾气丸',
  崔氏八味丸: '肾气丸',
  八味汤: '肾气丸',
  肾气汤: '肾气丸',
  芩加半夏生姜汤: '黄芩加半夏生姜汤',
  黄芩半夏生姜汤: '黄芩加半夏生姜汤',
  黄连轺赤小豆汤: '麻黄连轺赤小豆汤',
  黄连翘赤小豆汤: '麻黄连轺赤小豆汤',
  桂枝甘草大枣汤: '茯苓桂枝甘草大枣汤',
  桂枝白术甘草汤: '茯苓桂枝白术甘草汤',
  牡蛎龙骨救逆汤: '桂枝去芍药加蜀漆牡蛎龙骨救逆汤',
  救逆汤: '桂枝去芍药加蜀漆牡蛎龙骨救逆汤',
  四逆加猪胆汁汤: '通脉四逆加猪胆汁汤',
  枝加厚朴杏子汤: '桂枝加厚朴杏子汤',
  甘草龙骨牡蛎汤: '桂枝甘草龙骨牡蛎汤',
  胡加龙骨牡蛎汤: '柴胡加龙骨牡蛎汤',
  桂加茯苓白术汤: '桂枝去桂加茯苓白术汤',
  去芍药加附子汤: '桂枝去芍药加附子汤',
  黄芩黄连人参汤: '干姜黄芩黄连人参汤',
  黄芩芍药汤: '黄芩汤',
  龙荟丸: '当归龙荟丸',
  大黄礞石滚痰丸: '礞石滚痰丸',
  滚痰丸: '礞石滚痰丸',
  东垣安神丸: '朱砂安神丸',
  济生犀角地黄汤: '犀角地黄汤',
  三黄丸: '三黄汤',
  补血汤: '当归补血汤',
  小半夏茯苓汤: '小半夏加茯苓汤',
  麻杏甘石汤: '麻黄杏仁甘草石膏汤',
  黄芪建中汤: '黄耆建中汤',
  逍遥汤: '逍遥散',
  真武丸: '真武汤',
  实脾散: '实脾饮',
  归脾膏: '归脾汤',
  钱氏导赤散: '导赤散',
  济生归脾汤: '归脾汤',
  东垣凉膈散: '凉膈散',
  麦冬汤: '麦门冬汤',
  酸仁汤: '酸枣仁汤',
  旋复代赭汤: '旋复代赭石汤',
  正气散: '藿香正气散',
  败毒散: '活人败毒散',
  仿凉膈散: '凉膈散',
  曰白虎加人参汤: '白虎加人参汤',
  渇白虎加人参汤: '白虎加人参汤',
  仲景黄连阿胶汤: '黄连阿胶汤',
  生料五苓散: '五苓散',
  加减五苓散: '五苓散',
  应宜补中益气汤: '补中益气汤',
  东垣清心凉膈散: '凉膈散',
  辛凉平剂银翘散: '银翘散',
  辛凉轻剂桑菊饮: '桑菊饮',
  辛凉重剂白虎汤: '白虎汤',
  专翕膏: '专翕大生膏',
  故以加味清宫汤: '加味清宫汤',
  喻氏清燥救肺汤: '清燥救肺汤',
  牛黄丸: '安宫牛黄丸',
  仲景白通汤: '白通汤',
  许学士椒附汤: '椒附汤',
  虚劳小建中汤: '小建中汤',
  枝加龙骨牡蛎汤: '桂枝加龙骨牡蛎汤',
  翁加甘草阿胶汤: '白头翁加甘草阿胶汤',
  当以温经汤: '温经汤',
  甘姜苓术汤: '肾着汤',
  己椒苈黄丸: '防已椒目葶苈大黄丸',
  栝蒌瞿麦丸: '括蒌瞿麦薯蓣丸',
  括蒌瞿麦丸: '括蒌瞿麦薯蓣丸',
  防己茯苓汤: '防已茯苓汤',
  桂枝加黄耆汤: '桂枝加黄芪汤',
  桂枝加黄芪汤: '桂枝加黄芪汤',
  半夏厚朴汤: '半夏厚朴茯苓生姜汤',
  甘麦大枣汤: '甘草小麦大枣汤',
  土瓜根散: '王瓜根散',
  大黄甘遂汤: '大黄甘遂阿胶汤',
  麻黄附子汤: '麻黄附子甘草汤',
  加减二陈汤: '二陈汤',
  元戎四物汤: '四物汤',
  加减参附汤: '参附汤',
  五味异功散: '异功散',
  大秦芄汤: '大秦艽汤',
  人参败毒散: '活人败毒散',
  人参养营汤: '人参养荣汤',
  养荣汤: '人参养荣汤',
  养营汤: '人参养荣汤',
  胶艾四物汤: '芎归胶艾汤',
  八味饮: '肾气丸',
  五芩散: '五苓散',
  东垣益气汤: '补中益气汤',
  金匮肾气汤: '肾气丸',
  黄蓍建中汤: '黄耆建中汤',
  八珍丸: '八珍汤',
  黄连温胆汤: '温胆汤',
  人参温胆汤: '温胆汤',
  麻杏石甘汤: '麻黄杏仁甘草石膏汤',
  葛根黄连黄芩汤: '葛根黄芩黄连汤',
  桂枝白虎汤: '白虎加桂枝汤',
  曰桂枝白虎汤: '白虎加桂枝汤',
  四味香薷饮: '香薷饮',
  附子大顺散: '大顺散',
  参术四物汤: '四物汤',
  十补汤: '十补丸',
  星附六君子汤: '六君子汤',
  升麻清胃汤: '清胃散',
  枳实薤白汤: '枳实薤白桂枝汤',
  调气养荣汤: '人参养荣汤',
  豆当归散: '赤豆当归散',
  补心丹: '天王补心丹',
  鳖甲煎: '鳖甲煎丸',
  活命饮: '仙方活命饮',
  生料六味地黄丸: '六味地黄丸',
  加味归脾汤: '归脾汤',
  三五七散: '大三五七散',
  苇茎汤: '肺痈苇茎汤',
  古禹余粮丸: '禹余粮丸',
  桂枝加熟附子汤: '桂枝加附子汤',
  仿缩脾饮: '缩脾饮',
  前清解汤: '清解汤',
  葶苈大枣汤: '葶苈大枣泻肺汤',
  胃苓丸: '胃苓汤',
  胃芩汤: '胃苓汤',
  异攻散: '异功散',
  五味异攻散: '异功散',
  越脾汤: '越婢汤',
  活胜湿汤: '羌活胜湿汤',
  胜湿汤: '羌活胜湿汤',
  连翘饮: '连翘汤',
  六神汤: '六神散',
  枇杷叶膏: '枇杷叶散',
  四圣饮: '四圣散',
  当归活血汤: '当归活血散',
  调元汤: '调元散',
  人参当归散: '人参当归汤',
  知母散: '知母汤',
  半夏秫米汤: '秫米半夏汤',
  礞石大黄丸: '礞石滚痰丸',
  禹粮赤石脂丸: '赤石脂禹余粮汤',
  禹粮石脂丸: '赤石脂禹余粮汤',
  补血丸: '当归补血汤',
  椒附汤: '椒附丸',
  生熟地黄丸: '生熟地黄汤',
  星香散: '星香汤',
  万安膏: '万安散',
  清骨散: '清骨汤',
  加味芎归汤: '芎归汤',
  木香摈榔丸: '木香槟榔丸',
  倍参补中益气汤: '补中益气汤',
  倍参生化汤: '生化汤',
  加参生化汤: '生化汤',
  外台茯苓饮: '茯苓饮',
  千金苇茎汤: '肺痈苇茎汤',
  炒焦肾气丸: '肾气丸',
  张子和玉烛散: '玉烛散',
  东垣选竒汤: '选奇汤',
  选竒汤: '选奇汤',
  大补汤: '大补丸',
  // 景岳临床习称 → 八阵正名 / 他书基准
  清膈饮: '清膈煎',
  和胃煎: '和胃饮',
  安胃汤: '安胃饮',
  滋阴八味煎: '滋阴八味丸',
  滋隂八味煎: '滋阴八味丸',
  姜草汤: '甘草干姜汤',
  薑草汤: '甘草干姜汤',
  荆防败毒散: '人参败毒散',
  泼火散: '四味地榆散',
  国老饮: '解毒散',
  金银花散: '神功托里散',
  萆薢汤: '换肌消毒散',
  五色丸: '五癎丸',
  五痫丸: '五癎丸',
  一两益阴肾气丸: '益阴肾气丸',
  一两益隂肾气丸: '益阴肾气丸',
  肥儿丸: '四味肥儿丸',
  消痞大成膏: '消痞膏',
  肉荳丸: '肉豆丸',
  肉豆䓻丸: '肉豆丸',
  肉豆蔻丸: '肉豆丸',
  柴芩煎: '柴苓煎',
  子仁汤: '薏苡仁汤',
  蜀椒救中汤: '救中汤',
  黄连猪臓丸: '猪脏丸',
  黄连猪脏丸: '猪脏丸',
  神效交加散: '交加散',
  大秦芄汤: '大秦艽汤',
  人参白虎汤: '白虎加人参汤',
  酸仁汤: '酸枣仁汤',
  桂枝加黄耆汤: '桂枝加黄芪汤',
  人参养营汤: '人参养荣汤',
  加减参附汤: '参附汤',
  附子大顺散: '大顺散',
  地黄丸: '六味地黄丸',
  东垣地芝丸: '地芝丸',
  // 千金/金鉴提及截断或习称 → 同书/他书有药正名
  后大犀角汤: '大犀角汤',
  后犀角麻黄汤: '犀角麻黄汤',
  速与续命汤: '续命汤',
  岩蜜汤: '大岩蜜汤',
  苓甘术汤: '桂苓甘术汤',
  加猪胆汁汤: '白通加猪胆汁汤',
  // 续名医/临证习称
  白蒺藜丸: '蒺藜丸',
  内托十宣散: '十宣散',
  人参温脾汤: '温脾汤',
  大温经汤: '温经汤',
  疎黄连汤: '内疎黄连汤',
  疏黄连汤: '内疎黄连汤',
  补中汤: '补中益气汤',
  固本丸: '人参固本丸',
  参术白术散: '白术散',
  // 空壳别名 → 金鉴/千金/外台/宋本/桂林/景岳有药正名
  排脓内补十宣散: '十宣散',
  大黄耆汤: '黄耆汤',
  乐令大黄耆汤: '黄耆汤',
  乐令黄芪汤: '黄耆汤',
  大黄芪汤: '黄耆汤',
  藿香散: '藿香汤',
  麻黄葛根汤: '葛根汤',
  加味左归饮: '左归饮',
  代白虎汤: '石膏粳米汤',
  补阴托里散: '托里散',
  前三生饮: '三生饮',
  后来复汤: '来复汤',
  曰补中升气汤: '补中益气汤',
  补中升气汤: '补中益气汤',
}

function normalizeFormulaNameKey(name: string): string {
  let text = name
    .replace(/隂/g, '阴')
    .replace(/陽/g, '阳')
    .replace(/關|闗/g, '关')
    .replace(/囘/g, '回')
    .replace(/茋/g, '芪')
    .replace(/蓍/g, '芪')
    .replace(/营/g, '荣')
    .replace(/竒/g, '奇')
    .replace(/炁/g, '气')
    .replace(/疎/g, '疏')
    .replace(/摈榔/g, '槟榔')
    .replace(/荳/g, '豆')
    .replace(/臓/g, '脏')
    .replace(/芩散$/, '苓散')
    .replace(/芩汤$/, '苓汤')
    .replace(/芩丸$/, '苓丸')
    .replace(/饮子$/, '饮')
    .trim()
  // 学派/书名冠称，便于对齐金鉴/千金/外台基准
  text = text.replace(
    /^(?:仲景|仲师|河间|东垣|丹溪|景岳|张景岳|钱氏|崔氏|薛氏|洁古|海藏|陈氏|汤氏|金匮|喻氏|许学士|刘松石|千金|外台|陈无择|张子和|青囊|吴又可|张锡纯|乐令|沈月光|陈远公)/,
    '',
  )
  text = text.replace(
    /^(?:治以|投以|调以|宜用|宜服|发之|掺之|送下|无妨|后续进|风剂以|暂以|故以|故|仿|曰|再服|先服|后服|又服|兼服|倍参|加参|速与)?(?:大剂|一味|一大剂|炒焦)?/,
    '',
  )
  text = text.replace(/^与|^用|^此即|^即|^此|^效(?=[大小])/, '')
  // 「服后大犀角汤」「仍服后犀角麻黄汤」——「后」表继服，非方名一部分
  text = text.replace(/^后(?=大犀角|犀角麻黄)/, '')
  text = text.replace(/^张景岳气血两治之/, '')
  text = text.replace(/^极效|^火烘熨之|^汗出为度|^当减半/, '')
  if (text === '益气汤') text = '补中益气汤'
  if (text === '肾气汤') text = '肾气丸'
  return text.trim()
}

function canonicalFormulaName(name: string): string {
  const normalized = normalizeFormulaNameKey(name)
  return FORMULA_NAME_ALIASES[normalized] ?? FORMULA_NAME_ALIASES[name] ?? normalized
}

const SINGLE_CHAR_HERB_OK = new Set(['艾', '蜡', '酥', '蜜', '粉', '豉', '胶', '椒', '枣', '葱', '姜', '矾'])

const JUNK_HERB_NAME_RE =
  /不调|频数|频吐|痰涎|恶寒|困倦|烦渴|自汗|不可|湿热|方退|鼓证|恍惚|元气|俱热|后重|病痊|药力|滤过|湿成|壅塞|昏乱|哮吼|四库|子部|分再服|分服|合煮|一云|为度|帖而|再服|隂火|阴火|胀满|腰冷|如坐水|钦定|取微汁|去尖皮|钱或|两或|分或|口干|舌燥|小便|癃闭|冷痛|发热|往来|烦躁|痞满|腹胀|含化|调下|服之|取汁|澄清|绞取|贮不|津器|余药|篇章|下焦篇|中暑|脚气|风壅|内窍|三焦火|大孔|疹后|身重|脉浮|不解|自利|风温|温热|温疫|温毒|冬温|面赤|或已下|甚则齿黑|仍可下之|气血两燔|暑温|湿温|燥证|可多多|脱然全愈|当点心|大便久|年七旬|脑中作|共药十一|方中之|或偏枯|六七日|咽燥|口苦|腹满|恶热|愦愦|怵惕|懊|去汗|饥能使|能使饥|水[一二三四五六七八九十半]+盏|煎[一二三四五六七八九十半]+盏|其人恶风|恶风加|病仍不解|有表里|而烦|渴欲饮|水入则|反恶|身重烦|目疼|鼻干|不得卧|补血益气|不热不冷|温而调之|神妙难述|遂漏不止|四肢微急|难以屈伸/

function isJunkHerbEntry(name: string): boolean {
  if (!name) return true
  if (/^[一二三四五六七八九十百千万半]+$/.test(name)) return true
  if (name.length > 6) return true
  if (name.length === 1 && !SINGLE_CHAR_HERB_OK.has(name)) return true
  if (JUNK_HERB_NAME_RE.test(name)) return true
  if (/(?:汤|散|丸|煎|饮|丹)$/.test(name) && name.length >= 3) return true
  // 证候/篇章起句误入药味
  if (/^治|^卷|^以汁|^捣|^蜜水|^金银汤|^温服|^热辣|^一钱半或/.test(name)) return true
  if (/篇$|方$/.test(name) && /治|卷|证/.test(name)) return true
  return false
}

/** 去掉证候/服法残片，保留可用药味（避免因一味脏药清空整方） */
function sanitizeFormulaHerbs(formula: Formula): Formula {
  const remapped = formula.herbs.map((herb) => {
    if (herb.name === '黄' || herb.name === '黄耆' || herb.name === '黄蓍') {
      return { ...herb, name: '黄芪', herbId: '黄芪' }
    }
    if (herb.name === '云术') {
      return { ...herb, name: '白术', herbId: '白术' }
    }
    if (herb.name === '大附子') {
      return { ...herb, name: '附子', herbId: '附子' }
    }
    return herb
  })
  const herbs = remapped.filter((herb) => !isJunkHerbEntry(herb.name))
  if (
    herbs.length === formula.herbs.length &&
    herbs.every((herb, index) => herb.name === formula.herbs[index]?.name)
  ) {
    return formula
  }
  return { ...formula, herbs }
}

function herbsLookClean(formula: Formula): boolean {
  if (formula.herbs.length === 0) return false
  return formula.herbs.every((herb) => !isJunkHerbEntry(herb.name))
}

function donorScore(formula: Formula): number {
  if (!herbsLookClean(formula)) return -1
  let base = FORMULA_HERB_DONOR_PRIORITY[formula.book] ?? 10
  // 伤寒核心方：进一步压低千金/外台
  if (
    (SHANGHAN_CORE_NAMES.has(formula.name) ||
      SHANGHAN_CORE_NAMES.has(canonicalFormulaName(formula.name))) &&
    (formula.book === 'qianjin' || formula.book === 'waitai')
  ) {
    base = Math.min(base, 20)
  }
  // 脏味已滤掉后，略奖「味数适中」的正方，避免异方堆味抢 donor
  const sizeBonus = formula.herbs.length <= 12 ? formula.herbs.length : 12
  return base * 1000 + sizeBonus
}

function isBlockedCrossDonateName(name: string): boolean {
  return (
    QIANJIN_WAITAI_NO_CROSS_DONATE.has(name) ||
    QIANJIN_WAITAI_NO_CROSS_DONATE.has(canonicalFormulaName(name))
  )
}

/** 千金/外台裸方名不得向他书供药；承气汤对伤寒定本额外硬禁 */
function canDonateHerbs(donor: Formula, recipient: Formula): boolean {
  if (donor.book === recipient.book) return true
  if (!QIANJIN_WAITAI_BOOKS.has(donor.book)) return true
  if (!isBlockedCrossDonateName(donor.name) && !isBlockedCrossDonateName(recipient.name)) {
    return true
  }
  // 承气汤：明确禁止灌入伤寒定本
  if (
    SHANGHAN_BOOKS.has(recipient.book) &&
    (recipient.name === '承气汤' || donor.name === '承气汤')
  ) {
    return false
  }
  return false
}

/**
 * 仲景方定本（宋本/金匮/桂林）只接受仲景方系统内的同名方回填：三书互补，
 * 医宗金鉴《订正仲景全书》为其注本。千金/外台等同名异方多，不得灌入。
 */
const ZHONGJING_DONOR_BOOKS = new Set(['songben', 'jingui', 'guilin', 'yizong'])

/** 回填来源书允许列表：仲景定本见上；其余书只接受有供药优先级的书 */
function isBackfillDonorBookAllowed(donorBook: BookId, recipientBook: BookId): boolean {
  if (SHANGHAN_BOOKS.has(recipientBook)) return ZHONGJING_DONOR_BOOKS.has(donorBook)
  return FORMULA_HERB_DONOR_PRIORITY[donorBook] !== undefined
}

/** 炮制/规格/产地前缀：herb-lexicon 未收「白茯苓」「干山药」「生石膏」等写法，去掉后再解析 */
const HERB_QUALIFIER_PREFIX_RE = /^(?:生|炙|炒|制|煨|酒|醋|盐|蜜|净|鲜|干|白|赤|川|广)/
const MIN_QUALIFIED_HERB_BASE_LENGTH = 2

/** 仅用于回填的可解析判定，不改写药名 */
function isResolvableHerbName(name: string): boolean {
  if (isKnownHerbName(name)) return true
  const base = name.replace(HERB_QUALIFIER_PREFIX_RE, '')
  return base !== name && base.length >= MIN_QUALIFIED_HERB_BASE_LENGTH && isKnownHerbName(base)
}

/** 炮制、服法残片（「酒炒」「去目微炒」「以上并捣」「用水一斛」），出现在不可解析的药名里即视为脏 */
const PREPARATION_FRAGMENT_RE = /炒|炙|浸|蒸|研|捣|煮|煎|去|为末|细末|用水|以上|每|入/

function isBackfillJunkHerbName(name: string): boolean {
  if (isJunkHerbEntry(name)) return true
  return !isResolvableHerbName(name) && PREPARATION_FRAGMENT_RE.test(name)
}

const HERB_BACKFILL_POLICY: HerbBackfillPolicy = {
  sanitize: sanitizeFormulaHerbs,
  canonicalName: canonicalFormulaName,
  donorScore,
  isDonorBookAllowed: isBackfillDonorBookAllowed,
  canDonate: canDonateHerbs,
  isJunkHerbName: isBackfillJunkHerbName,
  isKnownHerbName: isResolvableHerbName,
}

function buildHerbs(formulas: Formula[], monographs: HerbMonograph[]): Herb[] {
  const map = new Map<string, Herb>()
  for (const formula of formulas) {
    const corpus = CORPUS_MAP[formula.book]
    for (const herb of formula.herbs) {
      const current = map.get(herb.herbId) ?? {
        id: herb.herbId,
        name: herb.name,
        aliases: [],
        formulaIds: [],
        frequency: 0,
        formulaIdsByCorpus: {},
      }
      current.frequency += 1
      if (!current.formulaIds.includes(formula.id)) current.formulaIds.push(formula.id)
      const byCorpus = current.formulaIdsByCorpus ?? {}
      const list = byCorpus[corpus] ?? []
      if (!list.includes(formula.id)) list.push(formula.id)
      byCorpus[corpus] = list
      current.formulaIdsByCorpus = byCorpus
      map.set(herb.herbId, current)
    }
  }
  for (const mono of monographs) {
    const current = map.get(mono.herbId) ?? {
      id: mono.herbId,
      name: mono.name,
      aliases: [],
      formulaIds: [],
      frequency: 0,
      formulaIdsByCorpus: {},
    }
    current.monographId = mono.id
    map.set(mono.herbId, current)
  }
  return [...map.values()].sort((a, b) => b.frequency - a.frequency)
}

function buildSearchDocs(
  clauses: Clause[],
  formulas: Formula[],
  herbs: Herb[],
  monographs: HerbMonograph[],
): SearchDoc[] {
  const docs: SearchDoc[] = []
  for (const clause of clauses) {
    docs.push({
      id: clause.id,
      type: 'clause',
      title: `${clause.book}·${clause.heading ?? clause.chapter}·${clause.order}`,
      text: clause.text,
      book: clause.book,
      corpus: CORPUS_MAP[clause.book],
      href: `/read/${clause.book}?clause=${clause.id}`,
    })
  }
  for (const formula of formulas) {
    docs.push({
      id: formula.id,
      type: 'formula',
      title: formula.name,
      text: `${formula.name} ${formula.herbs.map((herb) => herb.name).join(' ')} ${formula.preparation} ${formula.fangjie ?? ''}`,
      book: formula.book,
      corpus: CORPUS_MAP[formula.book],
      href: `/formulas/${encodeURIComponent(formula.id)}`,
    })
    if (formula.fangjie) {
      docs.push({
        id: `${formula.id}-fangjie`,
        type: 'fangjie',
        title: `${formula.name}方解`,
        text: formula.fangjie,
        book: formula.book,
        corpus: CORPUS_MAP[formula.book],
        href: `/formulas/${encodeURIComponent(formula.id)}`,
      })
    }
  }
  for (const herb of herbs) {
    docs.push({
      id: herb.id,
      type: 'herb',
      title: herb.name,
      text: `${herb.name} ${herb.aliases.join(' ')}`,
      href: `/herbs/${encodeURIComponent(herb.id)}`,
    })
  }
  for (const mono of monographs) {
    docs.push({
      id: mono.id,
      type: 'monograph',
      title: `本草新编·${mono.name}`,
      text: `${mono.name} ${mono.summary}`,
      book: 'bencao',
      corpus: 'chenfu',
      href: `/herbs/${encodeURIComponent(mono.herbId)}`,
    })
  }
  return docs
}

function collectRuleRoles(formulas: Formula[]): HerbRole[] {
  const roles: HerbRole[] = []
  for (const formula of formulas) {
    if (!formula.fangjie) continue
    const extracted = extractHerbRolesFromFangjie({
      formulaId: formula.id,
      fangjie: formula.fangjie,
      herbIds: formula.herbs.map((h) => h.herbId),
      herbNames: formula.herbs.map((h) => h.name),
    })
    roles.push(...extracted)
  }
  return roles
}

async function loadLlmEnrichment(): Promise<{
  roles: HerbRole[]
  clauseTags: Map<string, { symptomTags: string[]; pathogenesisTags: string[]; misjudgment?: Clause['misjudgment'] }>
}> {
  const root = projectRoot()
  const books = ['funvke', 'funanke', 'bianzheng', 'shishi']
  const roles: HerbRole[] = []
  const clauseTags = new Map<
    string,
    { symptomTags: string[]; pathogenesisTags: string[]; misjudgment?: Clause['misjudgment'] }
  >()

  for (const book of books) {
    const cachePath = path.join(root, 'data', 'annotations', 'chenfu-llm', `${book}.json`)
    if (!(await fileExists(cachePath))) continue
    try {
      const payload = JSON.parse(await readText(cachePath)) as {
        entries?: Array<{
          clauseId: string
          symptomTags?: string[]
          pathogenesisTags?: string[]
          misjudgment?: Clause['misjudgment']
          herbRoles?: HerbRole[]
        }>
      }
      for (const entry of payload.entries ?? []) {
        clauseTags.set(entry.clauseId, {
          symptomTags: entry.symptomTags ?? [],
          pathogenesisTags: entry.pathogenesisTags ?? [],
          misjudgment: entry.misjudgment,
        })
        for (const role of entry.herbRoles ?? []) {
          roles.push(role)
        }
      }
    } catch (error) {
      console.warn(`[build] skip llm cache ${book}:`, error)
    }
  }
  return { roles, clauseTags }
}

function mergeRoles(ruleRoles: HerbRole[], llmRoles: HerbRole[]): HerbRole[] {
  const map = new Map<string, HerbRole>()
  // 规则优先
  for (const role of ruleRoles) {
    map.set(`${role.formulaId}|${role.herbId}|${role.roleText}`, role)
  }
  for (const role of llmRoles) {
    const key = `${role.formulaId}|${role.herbId}|${role.roleText}`
    if (!map.has(key)) {
      // 同方同药已有规则结果时跳过 llm
      const hasRule = [...map.keys()].some((k) => k.startsWith(`${role.formulaId}|${role.herbId}|`))
      if (hasRule) continue
      map.set(key, role)
    }
  }
  return [...map.values()]
}

function buildCrossLinks(formulas: Formula[]): CrossLink[] {
  const byName = new Map<string, Formula>()
  for (const formula of formulas) {
    if (CORPUS_MAP[formula.book] === 'jingfang') {
      byName.set(formula.name, formula)
    }
  }
  const links: CrossLink[] = []
  for (const formula of formulas) {
    if (CORPUS_MAP[formula.book] !== 'chenfu') continue
    for (const derived of formula.derivedFrom ?? []) {
      const jf = byName.get(derived.name)
      links.push({
        id: `${formula.id}__${derived.name}`,
        chenfuFormulaId: formula.id,
        derivedName: derived.name,
        jingfangFormulaId: jf?.id,
        sourceSentence: formula.fangjie?.slice(0, 80),
      })
      if (jf) {
        derived.formulaId = jf.id
      }
    }
  }
  return links
}

async function main(): Promise<void> {
  const root = projectRoot()
  const outDir = path.join(root, 'public', 'data')
  await ensureDir(outDir)

  const registry = await loadBookRegistry(root)
  console.log('[build] parsing sources via registry...')
  const bundles = await runAllParsers(registry)

  let clauses = await annotateClausesAsync(bundles.flatMap((bundle) => bundle.clauses))

  const herbBackfill = backfillFormulaHerbs(
    ensureMentionedFormulas(
      clauses,
      bundles.flatMap((bundle) => bundle.formulas),
    ),
    HERB_BACKFILL_POLICY,
  )
  let formulas = herbBackfill.formulas.filter(
    (formula) => formula.herbs.length > 0 || isPlausibleFormulaName(formula.name),
  )
  const monographs = bundles.flatMap((bundle) => bundle.monographs)

  console.log('[build] aligning songben ↔ guilin...')
  const songbenClauses = clauses.filter((clause) => clause.book === 'songben')
  const guilinClauses = clauses.filter((clause) => clause.book === 'guilin')
  const { alignments, uniqueGuilinIds } = alignSongbenToGuilin(songbenClauses, guilinClauses)
  const alignedMap = new Map(
    alignments.filter((item) => item.guilinId).map((item) => [item.songbenId, item.guilinId!]),
  )
  clauses = clauses.map((clause) =>
    clause.book === 'songben' && alignedMap.has(clause.id)
      ? { ...clause, alignedGuilinId: alignedMap.get(clause.id) }
      : clause,
  )

  console.log('[build] aligning chenfu parallels...')
  const funvkeClauses = clauses.filter((c) => c.book === 'funvke')
  const funankeClauses = clauses.filter((c) => c.book === 'funanke')
  const bianzhengClauses = clauses.filter((c) => c.book === 'bianzheng')
  const shishiClauses = clauses.filter((c) => c.book === 'shishi')
  // 辨证录妇人相关章
  const bianzhengWomen = bianzhengClauses.filter((c) =>
    /妇人|带下|月经|种子|妊娠|产后|乳|崩|经/.test(c.chapter + (c.heading ?? '')),
  )
  const nvkeAlign = alignChenfuParallels(funvkeClauses, bianzhengWomen.length > 0 ? bianzhengWomen : bianzhengClauses)
  const nankeAlign = alignChenfuParallels(funankeClauses, [...bianzhengClauses, ...shishiClauses])

  console.log('[build] loading llm enrichment + rule fangjie...')
  const llm = await loadLlmEnrichment()
  // 回写条款标签
  clauses = clauses.map((clause) => {
    const tags = llm.clauseTags.get(clause.id)
    if (!tags) return clause
    return {
      ...clause,
      symptomTags: tags.symptomTags.length > 0 ? tags.symptomTags : clause.symptomTags,
      pathogenesisTags:
        tags.pathogenesisTags.length > 0 ? tags.pathogenesisTags : clause.pathogenesisTags,
      misjudgment: tags.misjudgment ?? clause.misjudgment,
      reviewStatus: 'ai-draft' as const,
    }
  })

  const conceptIndex = await loadConceptLexicon(root)
  const lexiconErrors = validateConceptLexicon(conceptIndex.concepts)
  if (lexiconErrors.length > 0) {
    throw new Error(`concept lexicon invalid:\n${lexiconErrors.slice(0, 20).join('\n')}`)
  }
  // LLM 覆盖 tags 后重建 conceptIds，避免与图边漂移
  const rematch = rematchConceptIdsFromTags(clauses, conceptIndex.concepts)
  clauses = rematch.clauses

  const ruleRoles = collectRuleRoles(formulas.filter((f) => CORPUS_MAP[f.book] === 'chenfu'))
  const herbRoles = mergeRoles(ruleRoles, llm.roles)

  console.log('[build] computing relations...')
  const families = computeFamilies(formulas)
  const familyMap = new Map(families.flatMap((family) => family.formulaIds.map((id) => [id, family.id])))
  formulas = formulas.map((formula) => ({
    ...formula,
    familyId: familyMap.get(formula.id) ?? formula.familyId,
  }))

  const jingfangSet = new Set<string>(JINGFANG_BOOKS)
  const jingfangDiffs = computeDiffPairs(
    formulas.filter((f) => jingfangSet.has(f.book)),
    clauses,
  )
  const chenfuDiffs = computeDiffPairs(
    formulas.filter((f) => CORPUS_MAP[f.book] === 'chenfu'),
    clauses,
  )
  const diffPairs = [...jingfangDiffs, ...chenfuDiffs]
  const crossLinks = buildCrossLinks(formulas)
  const herbs = buildHerbs(formulas, monographs)
  const searchDocs = buildSearchDocs(clauses, formulas, herbs, monographs)

  console.log('[build] merging integration evidence...')
  const publishGate = resolvePublishGate()
  const integrationInputs = await loadIntegrationInputs(root)
  const evidenceMerge = mergeEvidenceFiles(integrationInputs.evidenceFiles.map((item) => item.data))
  const attributesGate = gateClauseAttributes(integrationInputs.clauseAttributes, publishGate)
  const clauseApply = applyIntegrationToClauses(
    clauses,
    evidenceMerge.byEntity,
    attributesGate.attributes,
    publishGate,
  )
  clauses = clauseApply.items
  const formulaApply = applyIntegrationToFormulas(formulas, evidenceMerge.byEntity, publishGate)
  formulas = formulaApply.items
  const commentaryGate = gateCommentaries(integrationInputs.commentaries ?? [], publishGate)
  const syndromeGate = gateSyndromes(integrationInputs.syndromes ?? [], publishGate)
  const lexiconConceptIds = new Set(conceptIndex.concepts.map((concept) => concept.id))
  const syndromeConcepts = mergeSyndromeConcepts(
    conceptIndex.concepts,
    syndromeGate.syndromes.map((syndrome) =>
      syndromeToConcept(syndrome, publishGate, evidenceMerge.byEntity, lexiconConceptIds),
    ),
  )
  const clauseIdSet = new Set(clauses.map((clause) => clause.id))
  const knownEntityIds = new Set<string>([
    ...clauseIdSet,
    ...formulas.map((formula) => formula.id),
    ...commentaryGate.validIds,
    ...syndromeGate.validIds,
  ])
  const orphanEntityIds = [...evidenceMerge.byEntity.keys()].filter((id) => !knownEntityIds.has(id))
  const disputedClauseIds = clauses
    .filter((clause) => clause.evidenceLevel === 'disputed')
    .map((clause) => clause.id)
  const disputedFormulaIds = formulas
    .filter((formula) => formula.evidenceLevel === 'disputed')
    .map((formula) => formula.id)
  const integrationValidation = {
    mode: publishModeLabel(publishGate),
    publishUnlicensedEnv: PUBLISH_UNLICENSED_ENV,
    files: {
      evidence: integrationInputs.evidenceFiles.map((item) => item.file),
      missing: integrationInputs.missingFiles,
      invalid: integrationInputs.invalidFiles,
    },
    witnessCount: integrationInputs.witnesses?.length ?? null,
    records: {
      merged: evidenceMerge.recordCount,
      invalid: evidenceMerge.invalidRecordCount,
      duplicate: evidenceMerge.duplicateRecordCount,
      entities: evidenceMerge.byEntity.size,
      orphanEntityCount: orphanEntityIds.length,
      orphanEntitySample: orphanEntityIds.slice(0, VALIDATION_SAMPLE_LIMIT),
    },
    clauseLevelsByBook: countEvidenceLevelsByBook(clauses),
    formulaLevelsByBook: countEvidenceLevelsByBook(formulas),
    disputed: {
      clauseCount: disputedClauseIds.length,
      formulaCount: disputedFormulaIds.length,
      clauseIds: disputedClauseIds.slice(0, VALIDATION_SAMPLE_LIMIT),
      formulaIds: disputedFormulaIds.slice(0, VALIDATION_SAMPLE_LIMIT),
    },
    commentaries: {
      input: commentaryGate.inputCount,
      invalid: commentaryGate.invalidCount,
      published: commentaryGate.commentaries.length,
      droppedNoVerifiedQuote: commentaryGate.droppedNoVerifiedQuote,
      droppedUnverifiedQuotes: commentaryGate.droppedUnverifiedQuotes,
      orphanClauseCount: commentaryGate.commentaries.filter((item) => !clauseIdSet.has(item.clauseId))
        .length,
      summaryPublished: false,
    },
    syndromes: {
      input: syndromeGate.inputCount,
      invalid: syndromeGate.invalidCount,
      published: syndromeGate.syndromes.length - syndromeConcepts.conflictIds.length,
      conceptIdConflicts: syndromeConcepts.conflictIds,
    },
    kangpingLayer: {
      input: attributesGate.inputCount,
      invalid: attributesGate.invalidCount,
      published: clauses.filter((clause) => clause.kangpingLayer).length,
    },
  }

  const index: DatasetIndex = {
    books: registry.map((entry) => {
      const bookClauses = clauses.filter((c) => c.book === entry.id)
      return {
        id: entry.id as BookId,
        title: entry.title,
        corpus: entry.corpus,
        clauseCount: bookClauses.length,
        formulaCount: formulas.filter((f) => f.book === entry.id).length,
        chapterCount: new Set(bookClauses.map((c) => c.chapter)).size,
      }
    }),
    herbCount: herbs.length,
    formulaCount: formulas.length,
    clauseCount: clauses.length,
    diffPairCount: diffPairs.length,
    herbRoleCount: herbRoles.length,
    monographCount: monographs.length,
    generatedAt: new Date().toISOString(),
    sources: registry.map((entry) => ({
      id: entry.id as BookId,
      title: entry.fullTitle,
      url: entry.sourceUrl,
    })),
  }

  await writeJson(path.join(outDir, 'index.json'), index)
  for (const entry of registry.filter((book) => book.hasClauses)) {
    await writeJson(
      path.join(outDir, `clauses-${entry.id}.json`),
      clauses.filter((c) => c.book === entry.id),
    )
  }
  await writeJson(path.join(outDir, 'formulas.json'), formulas)
  await writeJson(path.join(outDir, 'herbs.json'), herbs)
  await writeJson(path.join(outDir, 'diff-pairs.json'), diffPairs)
  await writeJson(path.join(outDir, 'families.json'), families)
  await writeJson(path.join(outDir, 'alignments.json'), { alignments, uniqueGuilinIds })
  await writeJson(path.join(outDir, 'parallels.json'), { nvkeAlign, nankeAlign })
  await writeJson(path.join(outDir, 'herb-roles.json'), herbRoles)
  await writeJson(path.join(outDir, 'herb-monographs.json'), monographs)
  await writeJson(path.join(outDir, 'cross-links.json'), crossLinks)
  await writeJson(path.join(outDir, 'search-docs.json'), searchDocs)
  // 总是覆盖写出，避免先前 flag 模式的产物残留在 public
  await writeJson(path.join(outDir, 'commentaries.json'), commentaryGate.commentaries)

  console.log('[build] building reasoning dataset...')
  const reasoningTrees = JSON.parse(
    await readText(path.join(root, 'data', 'reasoning', 'trees.json')),
  ) as ReasoningTreeInput[]
  const reasoningFormulas = JSON.parse(
    await readText(path.join(root, 'data', 'reasoning', 'formulas.json')),
  ) as FormulaReasoningInput[]
  const reasoning = buildReasoningDataset(reasoningTrees, reasoningFormulas, formulas, clauses)
  await writeJson(path.join(outDir, 'reasoning.json'), reasoning)

  const compareTopics = JSON.parse(
    await readText(path.join(root, 'data', 'reasoning', 'compare-topics.json')),
  ) as CompareTopicInput[]
  const chenfuReasoning = buildChenfuReasoningDataset({
    clauses,
    formulas,
    caches: await loadChenfuCaches(root),
    parallels: [...nvkeAlign, ...nankeAlign],
    compareTopics,
    reasoningFormulaNames: reasoningFormulas.map((input) => input.formulaName),
  })
  await writeJson(path.join(outDir, 'reasoning-chenfu.json'), chenfuReasoning)

  console.log('[build] building knowledge graph...')
  const graph = await buildGraphDataset({
    registry,
    clauses,
    formulas,
    herbs,
    monographs,
    families,
    herbRoles,
    crossLinks,
    alignments,
    parallels: [...nvkeAlign, ...nankeAlign],
    chenfuReasoning,
    concepts: syndromeConcepts.concepts,
    integration: {
      commentaries: commentaryGate.commentaries,
      syndromes: syndromeGate.syndromes,
      evidence: evidenceMerge.byEntity,
      gate: publishGate,
    },
  })
  const graphDir = path.join(outDir, 'graph')
  await ensureDir(graphDir)
  await writeJson(path.join(graphDir, 'nodes.json'), graph.nodes)
  for (const [edgeType, edges] of Object.entries(graph.edgesByType)) {
    await writeJson(path.join(graphDir, `edges-${edgeType}.json`), edges)
  }
  for (const [nodeType, adj] of Object.entries(graph.adjacencyByNodeType)) {
    await writeJson(path.join(graphDir, `adjacency-${nodeType}.json`), adj)
  }
  await writeJson(path.join(outDir, 'concepts.json'), graph.concepts)
  const curriculumPath = path.join(root, 'data', 'ontology', 'curriculum.json')
  if (await fileExists(curriculumPath)) {
    await writeJson(
      path.join(outDir, 'curriculum.json'),
      JSON.parse(await readText(curriculumPath)),
    )
  }

  const unmappedFromTags = collectUnmappedLabels(clauses, graph.concepts)
  const unmappedByKey = new Map(
    [...rematch.unmapped, ...unmappedFromTags].map((item) => [`${item.type}:${item.label}`, item]),
  )
  const unmapped = [...unmappedByKey.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'),
  )
  await writeUnmappedReport(root, unmapped)

  const parseStats = Object.fromEntries(
    bundles.map((bundle) => [
      bundle.bookId,
      bundle.validation ?? bundle.stats ?? null,
    ]),
  )

  await writeJson(path.join(outDir, 'validation.json'), {
    ...parseStats,
    herbRoles: { rule: ruleRoles.length, llm: llm.roles.length, merged: herbRoles.length },
    graph: graph.stats,
    integration: integrationValidation,
    formulaBackfill: {
      eligibleDonors: herbBackfill.eligibleDonorCount,
      backfilled: herbBackfill.backfilled.length,
      unresolvedOwnReplaced: herbBackfill.unresolvedOwnReplaced,
      unresolvedOwnKept: herbBackfill.unresolvedOwnKept.slice(0, VALIDATION_SAMPLE_LIMIT),
      unresolvedOwnKeptCount: herbBackfill.unresolvedOwnKept.length,
    },
    unmappedCount: unmapped.length,
    note: '证候标签与方解作用含规则/大模型草稿（ai-draft），需人工校对',
  })

  console.log(
    `[build] done clauses=${clauses.length} formulas=${formulas.length} herbs=${herbs.length} diffs=${diffPairs.length} roles=${herbRoles.length} mono=${monographs.length} reasoningTrees=${reasoning.trees.length} reasoningFormulas=${reasoning.formulas.length} graphNodes=${graph.nodes.length} graphEdges=${graph.stats.edgeCount}`,
  )
  console.log(
    `[build] integration mode=${integrationValidation.mode} evidenceRecords=${evidenceMerge.recordCount} clausesWithEvidence=${clauseApply.matchedIds.size} formulasWithEvidence=${formulaApply.matchedIds.size} commentaries=${commentaryGate.commentaries.length} syndromes=${syndromeGate.syndromes.length} missing=${integrationInputs.missingFiles.length} backfilled=${herbBackfill.backfilled.length}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

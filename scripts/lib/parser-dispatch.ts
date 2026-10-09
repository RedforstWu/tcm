import type { BookId, Clause, Formula, HerbMonograph } from '../../src/types/data.ts'
import type { BookRegistryEntry } from './books-registry.ts'
import { REGISTERED_PARSERS, type RegisteredParser } from './parser-keys.ts'
import { runSongbenParse } from '../parse/songben.ts'
import { runJinguiParse } from '../parse/jingui.ts'
import { runGuilinParse } from '../parse/guilin.ts'
import { runFunvkeParse } from '../parse/funvke.ts'
import { runFunankeParse } from '../parse/funanke.ts'
import { runBianzhengParse } from '../parse/bianzheng.ts'
import { runShishiParse } from '../parse/shishi.ts'
import { runBencaoParse } from '../parse/bencao.ts'
import { runShennongParse } from '../parse/shennong.ts'
import { runXinxiuParse } from '../parse/xinxiu.ts'
import { runZhengleiParse } from '../parse/zhenglei.ts'
import { runWenbingParse } from '../parse/wenbing.ts'
import { runWenreParse } from '../parse/wenre.ts'
import { runPiweiParse } from '../parse/piwei.ts'
import { runDanxiParse } from '../parse/danxi.ts'
import { runRumenParse } from '../parse/rumen.ts'
import { runXiaoerParse } from '../parse/xiaoer.ts'
import { runJingyueParse } from '../parse/jingyue.ts'
import { runZhongxiParse } from '../parse/zhongxi.ts'
import { runLinzhengParse } from '../parse/linzheng.ts'
import { runMingyiParse } from '../parse/mingyi.ts'
import { runXumingyiParse } from '../parse/xumingyi.ts'
import { runYizongParse } from '../parse/yizong.ts'
import { runQianjinParse } from '../parse/qianjin.ts'
import { runWaitaiParse } from '../parse/waitai.ts'

export interface ParseBundle {
  bookId: BookId
  clauses: Clause[]
  formulas: Formula[]
  monographs: HerbMonograph[]
  validation?: unknown
  stats?: unknown
}

type ParserFn = () => Promise<{
  clauses?: Clause[]
  formulas?: Formula[]
  monographs?: HerbMonograph[]
  validation?: unknown
  stats?: unknown
}>

const PARSER_MAP: Record<RegisteredParser, ParserFn> = {
  songben: runSongbenParse,
  jingui: runJinguiParse,
  guilin: runGuilinParse,
  funvke: runFunvkeParse,
  funanke: runFunankeParse,
  bianzheng: runBianzhengParse,
  shishi: runShishiParse,
  bencao: runBencaoParse,
  shennong: runShennongParse,
  xinxiu: runXinxiuParse,
  zhenglei: runZhengleiParse,
  wenbing: runWenbingParse,
  wenre: runWenreParse,
  piwei: runPiweiParse,
  danxi: runDanxiParse,
  rumen: runRumenParse,
  xiaoer: runXiaoerParse,
  jingyue: runJingyueParse,
  zhongxi: runZhongxiParse,
  linzheng: runLinzhengParse,
  mingyi: runMingyiParse,
  xumingyi: runXumingyiParse,
  yizong: runYizongParse,
  qianjin: runQianjinParse,
  waitai: runWaitaiParse,
}

const _keys: RegisteredParser[] = [...REGISTERED_PARSERS]
for (const key of _keys) {
  if (!PARSER_MAP[key]) throw new Error(`PARSER_MAP missing ${key}`)
}

export async function runParserForBook(entry: BookRegistryEntry): Promise<ParseBundle> {
  const runner = PARSER_MAP[entry.parser as RegisteredParser]
  if (!runner) {
    throw new Error(`Unknown parser "${entry.parser}" for book ${entry.id}`)
  }
  const result = await runner()
  return {
    bookId: entry.id as BookId,
    clauses: result.clauses ?? [],
    formulas: result.formulas ?? [],
    monographs: result.monographs ?? [],
    validation: result.validation,
    stats: result.stats,
  }
}

export async function runAllParsers(entries: BookRegistryEntry[]): Promise<ParseBundle[]> {
  const bundles: ParseBundle[] = []
  for (const entry of entries) {
    bundles.push(await runParserForBook(entry))
  }
  return bundles
}

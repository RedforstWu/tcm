export type BookId =
  | 'songben'
  | 'jingui'
  | 'guilin'
  | 'bianzheng'
  | 'shishi'
  | 'bencao'
  | 'funvke'
  | 'funanke'

export type Corpus = 'jingfang' | 'chenfu'

export type ReviewStatus = 'ai-draft' | 'reviewed'

export type DoseSystem = 'han' | 'qing'

export const BOOK_CORPUS: Record<BookId, Corpus> = {
  songben: 'jingfang',
  jingui: 'jingfang',
  guilin: 'jingfang',
  bianzheng: 'chenfu',
  shishi: 'chenfu',
  bencao: 'chenfu',
  funvke: 'chenfu',
  funanke: 'chenfu',
}

export const CHENFU_BOOKS: BookId[] = [
  'bianzheng',
  'shishi',
  'bencao',
  'funvke',
  'funanke',
]

export const JINGFANG_BOOKS: BookId[] = ['songben', 'jingui', 'guilin']

export interface Misjudgment {
  commonView: string
  trueView: string
}

export interface Clause {
  id: string
  book: BookId
  chapter: string
  chapterOrder: number
  order: number
  text: string
  formulaIds: string[]
  symptomTags: string[]
  pulseTags: string[]
  channelTags: string[]
  pathogenesisTags: string[]
  reviewStatus: ReviewStatus
  alignedGuilinId?: string
  variants?: TextVariant[]
  /** 陈傅：门名或条名 */
  heading?: string
  /** 陈傅：人以为……谁知…… */
  misjudgment?: Misjudgment
  /** 陈傅：女科/辨证录等对照条目 */
  parallelIds?: string[]
}

export interface TextVariant {
  position: number
  songben: string
  guilin: string
}

export interface FormulaHerb {
  herbId: string
  name: string
  rawText: string
  doseRaw: string
  doseLiang?: number
  doseSheng?: number
  doseCount?: number
  /** 清制剂量统一折算为钱 */
  doseQian?: number
  processing?: string
  note?: string
}

export interface Modification {
  condition: string
  remove: string[]
  add: Array<{ herbId: string; name: string; doseRaw: string }>
  rawText: string
}

export interface DerivedFrom {
  name: string
  formulaId?: string
}

export interface Formula {
  id: string
  name: string
  book: BookId
  herbs: FormulaHerb[]
  preparation: string
  modifications: Modification[]
  sourceClauseIds: string[]
  familyId?: string
  chapter?: string
  doseSystem?: DoseSystem
  role?: 'main' | 'alternate'
  alternateOf?: string
  derivedFrom?: DerivedFrom[]
  fangjie?: string
  anonymous?: boolean
}

export interface Herb {
  id: string
  name: string
  aliases: string[]
  formulaIds: string[]
  frequency: number
  formulaIdsByCorpus?: Partial<Record<Corpus, string[]>>
  monographId?: string
}

export type DiffKind = 'add' | 'remove' | 'dose'

export interface FormulaDiffPair {
  id: string
  fromId: string
  toId: string
  kind: DiffKind
  herbId: string
  herbName: string
  fromDoseRaw?: string
  toDoseRaw?: string
  symptomDelta: {
    gained: string[]
    lost: string[]
  }
  fromClauseIds: string[]
  toClauseIds: string[]
}

export interface FormulaFamily {
  id: string
  name: string
  baseFormulaId: string
  formulaIds: string[]
}

export interface AlignmentRecord {
  songbenId: string
  guilinId: string | null
  score: number
  uniqueToGuilin?: boolean
}

export interface ParallelAlignment {
  leftId: string
  rightId: string | null
  score: number
  leftBook: BookId
  rightBook?: BookId
}

export interface HerbRole {
  id: string
  formulaId: string
  herbId: string
  roleText: string
  mechanism?: string
  sourceSentence: string
  method: 'rule' | 'llm'
  reviewStatus: ReviewStatus
  model?: string
}

export interface HerbMonographQa {
  question: string
  answer: string
}

export interface HerbMonograph {
  id: string
  herbId: string
  name: string
  nature?: string
  flavor?: string
  channels: string[]
  toxicity?: string
  summary: string
  qa: HerbMonographQa[]
  rawText: string
  sourceBook: 'bencao'
}

export interface CrossLink {
  id: string
  chenfuFormulaId: string
  derivedName: string
  jingfangFormulaId?: string
  sourceSentence?: string
}

export interface DatasetIndex {
  books: Array<{
    id: BookId
    title: string
    corpus: Corpus
    clauseCount: number
    formulaCount: number
    chapterCount: number
  }>
  herbCount: number
  formulaCount: number
  clauseCount: number
  diffPairCount: number
  herbRoleCount?: number
  monographCount?: number
  generatedAt: string
  sources: Array<{ id: BookId; title: string; url: string }>
}

export interface SearchDoc {
  id: string
  type: 'clause' | 'formula' | 'herb' | 'monograph' | 'fangjie'
  title: string
  text: string
  book?: BookId
  corpus?: Corpus
  href: string
}

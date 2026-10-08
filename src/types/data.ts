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

export type DiffKind = 'add' | 'remove' | 'dose' | 'multi'

export interface FormulaDiffPair {
  id: string
  fromId: string
  toId: string
  kind: DiffKind
  herbId: string
  herbName: string
  fromDoseRaw?: string
  toDoseRaw?: string
  /** 多味差异时的加味列表 */
  addedHerbNames?: string[]
  /** 多味差异时的去味列表 */
  removedHerbNames?: string[]
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

export type NatureTag =
  | '热'
  | '寒'
  | '补'
  | '泻'
  | '升'
  | '降'
  | '收'
  | '散'
  | '润'
  | '燥'

export interface NatureIndex {
  热: number
  寒: number
  补: number
  泻: number
  升: number
  降: number
  收: number
  散: number
  润: number
  燥: number
}

export interface ReasoningHerb {
  name: string
  weight: number
  natures: NatureTag[]
  action: string
}

export interface ReasoningIndication {
  symptom: string
  herbNames: string[]
  rationale?: string
}

export interface ReasoningClauseRef {
  book: 'songben' | 'jingui'
  number: number
  excerpt: string
}

export interface TreeResult {
  formulaName: string
  note?: string
  addHerbs?: string[]
  formulaIds?: Array<string | undefined>
}

export interface TreeOption {
  label: string
  nextNodeId?: string
  result?: TreeResult
}

export interface TreeNode {
  question: string
  options: TreeOption[]
}

export interface ReasoningTree {
  id: string
  title: string
  sourcePage: number
  rootNodeId: string
  nodes: Record<string, TreeNode>
}

export interface FormulaReasoning {
  formulaName: string
  function: string
  sourcePage: number
  herbs: ReasoningHerb[]
  indications: ReasoningIndication[]
  clauseRefs: ReasoningClauseRef[]
  reviewStatus: ReviewStatus
  formulaId?: string
  natureIndex: NatureIndex
  clauseIds: string[]
}

export interface ReasoningDataset {
  trees: ReasoningTree[]
  formulas: FormulaReasoning[]
  generatedAt: string
  source: string
}

export type OrganTag =
  | '心'
  | '肝'
  | '脾'
  | '肺'
  | '肾'
  | '胃'
  | '胆'
  | '大肠'
  | '小肠'
  | '膀胱'
  | '三焦'
  | '心包'
  | '命门'

export type WuxingElement = '木' | '火' | '土' | '金' | '水'

export type OrganRelationKind = '生' | '克' | '乘' | '侮' | '移邪'

export type DisputeKind = 'misdiagnosis' | 'mistreatment' | 'drugDoubt' | 'commonPractice'

export type ChenfuReasoningBook = 'bianzheng' | 'funvke' | 'funanke' | 'shishi'

/** text：原文；heading：以标题为症；previous：承接同门上一则；none：原文未述 */
export type SymptomSource = 'text' | 'heading' | 'previous' | 'none'

export interface CaseDispute {
  kind: DisputeKind
  claim: string
  rebuttal: string
}

export interface OrganRelation {
  from: OrganTag
  to: OrganTag
  kind: OrganRelationKind
}

export interface ChenfuCase {
  caseId: string
  caseIndex: number
  symptomText?: string
  symptomSource: SymptomSource
  continuesFromClauseId?: string
  /** 方药并自下一则原文（辨证录切分错位） */
  prescriptionFromClauseId?: string
  disputes: CaseDispute[]
  pathogenesis?: string
  methodCategory?: string
  organs: OrganTag[]
  relations: OrganRelation[]
  elements: WuxingElement[]
  treatmentPrinciple?: string
  formulaIds: string[]
  formulaText?: string
  keySentence?: string
}

export interface ChenfuRecord {
  clauseId: string
  book: ChenfuReasoningBook
  chapter: string
  heading?: string
  symptomTags: string[]
  pathogenesisTags: string[]
  annotated: boolean
  cases: ChenfuCase[]
  parallelIds: string[]
}

export interface ChenfuFormula {
  id: string
  name: string
  preparation: string
  fangjie: string
}

export interface CompareFormulaRef {
  name: string
  formulaId?: string
  hasReasoning: boolean
}

export interface CompareTopic {
  id: string
  title: string
  description?: string
  jingfang: { treeId?: string; formulas: CompareFormulaRef[] }
  chenfuCaseIds: string[]
}

export interface ChenfuBookStats {
  records: number
  annotated: number
  cases: number
  disputeCounts: Record<DisputeKind | 'none', number>
}

export interface ChenfuReasoningDataset {
  generatedAt: string
  source: string
  reviewStatus: 'ai-draft'
  records: ChenfuRecord[]
  formulas: Record<string, ChenfuFormula>
  compareTopics: CompareTopic[]
  stats: Record<ChenfuReasoningBook, ChenfuBookStats>
}

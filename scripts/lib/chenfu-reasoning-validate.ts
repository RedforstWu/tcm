import {
  isDisputeKind,
  isOrganTag,
  isRelationKind,
  METHOD_CATEGORY_BOOKS,
  type DisputeKind,
  type OrganTag,
  type RelationKind,
} from './chenfu-reasoning-vocab.ts'

export interface CaseDispute {
  kind: DisputeKind
  claim: string
  rebuttal: string
}

export interface CaseRelation {
  from: OrganTag
  to: OrganTag
  kind: RelationKind
}

export interface ChenfuCase {
  caseIndex: number
  symptomText?: string
  disputes: CaseDispute[]
  pathogenesis?: string
  methodCategory?: string
  organs: OrganTag[]
  relations: CaseRelation[]
  treatmentPrinciple?: string
  formulaIds: string[]
  formulaText?: string
  keySentence?: string
}

export interface ValidationInput {
  clauseId: string
  contentHash: string
  book: string
  chapter: string
  text: string
  formulas: Array<{ formulaId: string; fangjie: string }>
}

/** 模型输出的原始形态：字段类型均不可信 */
export interface RawCase {
  caseIndex?: unknown
  symptomText?: unknown
  disputes?: unknown
  pathogenesis?: unknown
  methodCategory?: unknown
  organs?: unknown
  relations?: unknown
  treatmentPrinciple?: unknown
  formulaIds?: unknown
  formulaText?: unknown
  keySentence?: unknown
}

export interface RawEntry {
  clauseId?: unknown
  contentHash?: unknown
  cases?: unknown
}

export interface CaseValidationResult {
  caseItem: ChenfuCase | null
  rejects: string[]
}

export function normalizeForMatch(text: string): string {
  return text.replace(/[\s\u3000]+/g, '')
}

export function isSubstringOf(fragment: string, source: string): boolean {
  const needle = normalizeForMatch(fragment)
  if (!needle) return false
  return normalizeForMatch(source).includes(needle)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function checkSubstring(
  field: string,
  value: unknown,
  source: string,
  rejects: string[],
): string | undefined {
  const text = asString(value)
  if (text === undefined) return undefined
  if (!isSubstringOf(text, source)) {
    rejects.push(`${field} not substring: ${text.slice(0, 24)}`)
    return undefined
  }
  return text
}

export function validateCase(raw: RawCase, input: ValidationInput): CaseValidationResult {
  const rejects: string[] = []
  const caseIndex = typeof raw.caseIndex === 'number' ? raw.caseIndex : -1
  const prefix = `case#${caseIndex}`

  // 男科以标题为症、辨证录切分错位时正文以方药起首：症状可缺，由构建阶段补标题或「承上」
  const symptomText = checkSubstring(`${prefix}.symptomText`, raw.symptomText, input.text, rejects)

  const disputes: CaseDispute[] = []
  if (raw.disputes !== undefined && !Array.isArray(raw.disputes)) {
    rejects.push(`${prefix}.disputes not array`)
  }
  for (const [index, item] of (Array.isArray(raw.disputes) ? raw.disputes : []).entries()) {
    const dispute = (item ?? {}) as Record<string, unknown>
    const kind = asString(dispute.kind)
    if (!kind || !isDisputeKind(kind)) {
      rejects.push(`${prefix}.disputes[${index}].kind invalid: ${String(dispute.kind)}`)
      continue
    }
    const claim = checkSubstring(`${prefix}.disputes[${index}].claim`, dispute.claim, input.text, rejects)
    const rebuttal = checkSubstring(
      `${prefix}.disputes[${index}].rebuttal`,
      dispute.rebuttal,
      input.text,
      rejects,
    )
    if (!claim || !rebuttal) continue
    disputes.push({ kind, claim, rebuttal })
  }

  const pathogenesis = checkSubstring(`${prefix}.pathogenesis`, raw.pathogenesis, input.text, rejects)
  const treatmentPrinciple = checkSubstring(
    `${prefix}.treatmentPrinciple`,
    raw.treatmentPrinciple,
    input.text,
    rejects,
  )
  const formulaText = checkSubstring(`${prefix}.formulaText`, raw.formulaText, input.text, rejects)

  let methodCategory: string | undefined
  const rawMethod = asString(raw.methodCategory)
  if (rawMethod) {
    if (!(METHOD_CATEGORY_BOOKS as readonly string[]).includes(input.book)) {
      rejects.push(`${prefix}.methodCategory not allowed for ${input.book}`)
    } else if (!input.chapter.includes(rawMethod)) {
      rejects.push(`${prefix}.methodCategory not in chapter: ${rawMethod}`)
    } else {
      methodCategory = rawMethod
    }
  }

  const organs: OrganTag[] = []
  for (const organ of Array.isArray(raw.organs) ? raw.organs : []) {
    if (typeof organ === 'string' && isOrganTag(organ)) {
      if (!organs.includes(organ)) organs.push(organ)
    } else {
      rejects.push(`${prefix}.organ invalid: ${String(organ)}`)
    }
  }

  const relations: CaseRelation[] = []
  for (const item of Array.isArray(raw.relations) ? raw.relations : []) {
    const relation = (item ?? {}) as Record<string, unknown>
    const from = asString(relation.from)
    const to = asString(relation.to)
    const kind = asString(relation.kind)
    if (!from || !isOrganTag(from) || !to || !isOrganTag(to) || !kind || !isRelationKind(kind)) {
      rejects.push(`${prefix}.relation invalid: ${JSON.stringify(item)}`)
      continue
    }
    if (from === to) {
      rejects.push(`${prefix}.relation self-loop: ${from}`)
      continue
    }
    relations.push({ from, to, kind })
    for (const organ of [from, to]) {
      if (!organs.includes(organ)) organs.push(organ)
    }
  }

  const allowedFormulaIds = new Set(input.formulas.map((formula) => formula.formulaId))
  const formulaIds: string[] = []
  for (const formulaId of Array.isArray(raw.formulaIds) ? raw.formulaIds : []) {
    if (typeof formulaId === 'string' && allowedFormulaIds.has(formulaId)) {
      if (!formulaIds.includes(formulaId)) formulaIds.push(formulaId)
    } else {
      rejects.push(`${prefix}.formulaId not in clause: ${String(formulaId)}`)
    }
  }

  let keySentence: string | undefined
  const rawKey = asString(raw.keySentence)
  if (rawKey) {
    const primary = input.formulas.find((formula) => formula.formulaId === formulaIds[0])
    if (!primary || !primary.fangjie.trim()) {
      rejects.push(`${prefix}.keySentence without fangjie`)
    } else if (!isSubstringOf(rawKey, primary.fangjie)) {
      rejects.push(`${prefix}.keySentence not substring of fangjie: ${rawKey.slice(0, 24)}`)
    } else {
      keySentence = rawKey
    }
  }

  const hasSubstance = Boolean(
    symptomText || pathogenesis || treatmentPrinciple || formulaText || formulaIds.length > 0,
  )
  if (!hasSubstance) {
    rejects.push(`${prefix} dropped: no symptom, pathogenesis, principle or formula`)
    return { caseItem: null, rejects }
  }

  return {
    caseItem: {
      caseIndex,
      symptomText,
      disputes,
      pathogenesis,
      methodCategory,
      organs,
      relations,
      treatmentPrinciple,
      formulaIds,
      formulaText,
      keySentence,
    },
    rejects,
  }
}

export interface EntryValidationResult {
  cases: ChenfuCase[]
  rejects: string[]
  hardReject: boolean
}

export function validateEntry(
  raw: RawEntry,
  input: ValidationInput | undefined,
): EntryValidationResult {
  if (!input) return { cases: [], rejects: ['missing input entry'], hardReject: true }
  if (raw.contentHash !== input.contentHash) {
    return { cases: [], rejects: ['contentHash mismatch'], hardReject: true }
  }
  if (!Array.isArray(raw.cases)) {
    return { cases: [], rejects: ['cases not array'], hardReject: true }
  }

  const rejects: string[] = []
  const cases: ChenfuCase[] = []
  for (const rawCase of raw.cases as RawCase[]) {
    const result = validateCase(rawCase ?? {}, input)
    rejects.push(...result.rejects)
    if (result.caseItem) cases.push(result.caseItem)
  }
  cases.sort((left, right) => left.caseIndex - right.caseIndex)
  cases.forEach((caseItem, index) => {
    caseItem.caseIndex = index
  })
  return { cases, rejects, hardReject: false }
}

export function countDisputeKinds(cases: ChenfuCase[]): Record<DisputeKind | 'none', number> {
  const counts: Record<DisputeKind | 'none', number> = {
    misdiagnosis: 0,
    mistreatment: 0,
    drugDoubt: 0,
    commonPractice: 0,
    none: 0,
  }
  for (const caseItem of cases) {
    if (caseItem.disputes.length === 0) counts.none += 1
    for (const dispute of caseItem.disputes) counts[dispute.kind] += 1
  }
  return counts
}

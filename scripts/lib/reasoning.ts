import type { BookId, Clause, Formula, ReviewStatus } from '../../src/types/data.ts'

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

export const NATURE_TAGS: NatureTag[] = [
  '热',
  '寒',
  '补',
  '泻',
  '升',
  '降',
  '收',
  '散',
  '润',
  '燥',
]

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

export interface FormulaReasoningInput {
  formulaName: string
  function: string
  sourcePage: number
  herbs: ReasoningHerb[]
  indications: ReasoningIndication[]
  clauseRefs: ReasoningClauseRef[]
  reviewStatus: ReviewStatus
}

export interface TreeResult {
  formulaName: string
  note?: string
  addHerbs?: string[]
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

export interface ReasoningTreeInput {
  id: string
  title: string
  sourcePage: number
  rootNodeId: string
  nodes: Record<string, TreeNode>
}

/** 方名别名 → 数据集中的规范名 */
export const FORMULA_ALIASES: Record<string, string> = {
  麻杏甘石汤: '麻黄杏仁甘草石膏汤',
  麻黄杏仁甘草石膏汤: '麻黄杏仁甘草石膏汤',
  苓桂朮甘汤: '苓桂术甘汤',
  苓桂术甘汤: '苓桂术甘汤',
  茯苓桂枝白朮甘草汤: '苓桂术甘汤',
  茯苓桂枝白术甘草汤: '苓桂术甘汤',
  八味地黄丸: '肾气丸',
  八味肾气丸: '肾气丸',
  崔氏八味丸: '肾气丸',
  金匮肾气丸: '肾气丸',
}

const BOOK_PRIORITY: BookId[] = ['songben', 'jingui', 'guilin']

export function computeNatureIndex(herbs: ReasoningHerb[]): NatureIndex {
  const totalWeight = herbs.reduce((sum, herb) => sum + herb.weight, 0)
  const empty: NatureIndex = {
    热: 0,
    寒: 0,
    补: 0,
    泻: 0,
    升: 0,
    降: 0,
    收: 0,
    散: 0,
    润: 0,
    燥: 0,
  }
  if (totalWeight <= 0) return empty

  const index = { ...empty }
  for (const herb of herbs) {
    const natureSet = new Set(herb.natures)
    for (const tag of NATURE_TAGS) {
      if (natureSet.has(tag)) {
        index[tag] += herb.weight
      }
    }
  }
  for (const tag of NATURE_TAGS) {
    index[tag] = index[tag] / totalWeight
  }
  return index
}

export function validateTree(tree: ReasoningTreeInput): string[] {
  const errors: string[] = []
  const { id, rootNodeId, nodes } = tree

  if (!nodes[rootNodeId]) {
    errors.push(`[${id}] 根节点不存在: ${rootNodeId}`)
    return errors
  }

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node.options || node.options.length === 0) {
      errors.push(`[${id}] 节点 ${nodeId} 无选项`)
      continue
    }
    for (const [optionIndex, option] of node.options.entries()) {
      const hasNext = Boolean(option.nextNodeId)
      const hasResult = Boolean(option.result)
      if (hasNext === hasResult) {
        errors.push(
          `[${id}] 节点 ${nodeId} 选项#${optionIndex}「${option.label}」须恰好指定 nextNodeId 或 result 之一`,
        )
      }
      if (option.nextNodeId && !nodes[option.nextNodeId]) {
        errors.push(
          `[${id}] 节点 ${nodeId} 选项「${option.label}」引用不存在的节点: ${option.nextNodeId}`,
        )
      }
      if (option.result && !option.result.formulaName?.trim()) {
        errors.push(`[${id}] 节点 ${nodeId} 选项「${option.label}」结果缺少 formulaName`)
      }
    }
  }

  // 可达性
  const reachable = new Set<string>()
  const queue = [rootNodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (reachable.has(current)) continue
    reachable.add(current)
    const node = nodes[current]
    if (!node) continue
    for (const option of node.options) {
      if (option.nextNodeId) queue.push(option.nextNodeId)
    }
  }
  for (const nodeId of Object.keys(nodes)) {
    if (!reachable.has(nodeId)) {
      errors.push(`[${id}] 节点不可达: ${nodeId}`)
    }
  }

  // 环检测（仅沿 nextNodeId）
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dfs = (nodeId: string, path: string[]): void => {
    if (visiting.has(nodeId)) {
      errors.push(`[${id}] 存在环: ${[...path, nodeId].join(' → ')}`)
      return
    }
    if (visited.has(nodeId)) return
    visiting.add(nodeId)
    const node = nodes[nodeId]
    if (node) {
      for (const option of node.options) {
        if (option.nextNodeId) dfs(option.nextNodeId, [...path, nodeId])
      }
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  dfs(rootNodeId, [])

  return errors
}

export function normalizeFormulaName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, '')
  return FORMULA_ALIASES[trimmed] ?? trimmed
}

/** 拆合方名，如「五苓散+平胃散」→ ['五苓散','平胃散']；加味写在 result.addHerbs */
export function splitFormulaNames(formulaName: string): string[] {
  return formulaName
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function resolveFormulaId(
  name: string,
  formulas: Array<Pick<Formula, 'id' | 'name' | 'book'>>,
): string | undefined {
  const canonical = normalizeFormulaName(name)
  for (const book of BOOK_PRIORITY) {
    const hit = formulas.find((formula) => formula.book === book && formula.name === canonical)
    if (hit) return hit.id
  }
  const anyHit = formulas.find((formula) => formula.name === canonical)
  return anyHit?.id
}

export function resolveClauseIds(
  refs: ReasoningClauseRef[],
  clauses: Array<Pick<Clause, 'id' | 'book' | 'order'>>,
): string[] {
  const ids: string[] = []
  for (const ref of refs) {
    const hit = clauses.find((clause) => clause.book === ref.book && clause.order === ref.number)
    if (hit) ids.push(hit.id)
  }
  return ids
}

export interface BuiltTreeOption extends TreeOption {
  result?: TreeResult & { formulaIds: Array<string | undefined> }
}

export interface BuiltTreeNode {
  question: string
  options: BuiltTreeOption[]
}

export interface BuiltReasoningTree {
  id: string
  title: string
  sourcePage: number
  rootNodeId: string
  nodes: Record<string, BuiltTreeNode>
}

export interface BuiltFormulaReasoning extends FormulaReasoningInput {
  formulaId?: string
  natureIndex: NatureIndex
  clauseIds: string[]
}

export interface ReasoningDataset {
  trees: BuiltReasoningTree[]
  formulas: BuiltFormulaReasoning[]
  generatedAt: string
  source: string
}

export function buildReasoningDataset(
  trees: ReasoningTreeInput[],
  formulaInputs: FormulaReasoningInput[],
  formulas: Array<Pick<Formula, 'id' | 'name' | 'book'>>,
  clauses: Array<Pick<Clause, 'id' | 'book' | 'order'>>,
): ReasoningDataset {
  const treeErrors = trees.flatMap((tree) => validateTree(tree))
  if (treeErrors.length > 0) {
    throw new Error(`决策树校验失败:\n${treeErrors.join('\n')}`)
  }

  const builtTrees: BuiltReasoningTree[] = trees.map((tree) => {
    const nodes: Record<string, BuiltTreeNode> = {}
    for (const [nodeId, node] of Object.entries(tree.nodes)) {
      nodes[nodeId] = {
        question: node.question,
        options: node.options.map((option) => {
          if (!option.result) return { ...option }
          const names = splitFormulaNames(option.result.formulaName)
          return {
            ...option,
            result: {
              ...option.result,
              formulaIds: names.map((name) => resolveFormulaId(name, formulas)),
            },
          }
        }),
      }
    }
    return {
      id: tree.id,
      title: tree.title,
      sourcePage: tree.sourcePage,
      rootNodeId: tree.rootNodeId,
      nodes,
    }
  })

  const builtFormulas: BuiltFormulaReasoning[] = formulaInputs.map((input) => ({
    ...input,
    formulaId: resolveFormulaId(input.formulaName, formulas),
    natureIndex: computeNatureIndex(input.herbs),
    clauseIds: resolveClauseIds(input.clauseRefs, clauses),
  }))

  return {
    trees: builtTrees,
    formulas: builtFormulas,
    generatedAt: new Date().toISOString(),
    source: '林大栋《十二经方日用急急如律令》讲义整理，仅供学习',
  }
}

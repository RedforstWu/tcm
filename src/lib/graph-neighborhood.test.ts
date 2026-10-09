import { describe, expect, it } from 'vitest'
import { hrefForGraphNode, searchGraphNodes } from './graph'
import type { GraphNode } from '@/types/graph'

const nodes: GraphNode[] = [
  { id: 'songben', type: 'book', label: '宋本伤寒论' },
  { id: 'songben-formula-桂枝汤', type: 'formula', label: '桂枝汤', bookId: 'songben' },
  { id: 'symptom.恶寒', type: 'concept', label: '恶寒' },
  { id: '桂枝', type: 'herb', label: '桂枝' },
]

describe('searchGraphNodes', () => {
  it('ranks exact label before partial', () => {
    const hits = searchGraphNodes(nodes, '桂枝')
    expect(hits[0]?.id).toBe('桂枝')
    expect(hits.some((item) => item.id === 'songben-formula-桂枝汤')).toBe(true)
  })
})

describe('hrefForGraphNode', () => {
  it('maps ontology nodes to detail routes', () => {
    expect(hrefForGraphNode(nodes[0]!)).toBe('/read/songben')
    expect(hrefForGraphNode(nodes[1]!)).toBe(`/formulas/${encodeURIComponent('songben-formula-桂枝汤')}`)
    expect(hrefForGraphNode(nodes[2]!)).toBe(`/concept/${encodeURIComponent('symptom.恶寒')}`)
    expect(hrefForGraphNode(nodes[3]!)).toBe(`/herbs/${encodeURIComponent('桂枝')}`)
  })
})

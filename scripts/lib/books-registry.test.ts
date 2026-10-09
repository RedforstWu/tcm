import { describe, expect, it } from 'vitest'
import {
  renderBookTypesModule,
  validateBookRegistry,
  type BookRegistryEntry,
} from './books-registry.ts'

const sample: BookRegistryEntry[] = [
  {
    id: 'songben',
    title: '宋本伤寒论',
    shortName: '宋本',
    fullTitle: '宋本伤寒论（赵开美本）',
    corpus: 'jingfang',
    school: 'jingfang',
    author: '张仲景',
    era: '东汉',
    sourceUrl: 'https://example.com',
    parser: 'songben',
    order: 1,
    color: '#0f766e',
    hasClauses: true,
    doseSystem: 'han',
  },
  {
    id: 'bencao',
    title: '本草新编',
    shortName: '本草',
    fullTitle: '本草新编',
    corpus: 'chenfu',
    school: 'chenfu',
    author: '陈士铎',
    era: '清',
    sourceUrl: 'https://example.com',
    parser: 'bencao',
    order: 2,
    color: '#15803d',
    hasClauses: false,
    doseSystem: 'qing',
  },
]

describe('validateBookRegistry', () => {
  it('accepts valid entries', () => {
    expect(validateBookRegistry(sample)).toEqual([])
  })

  it('rejects duplicate ids and unknown parser', () => {
    const bad = [
      ...sample,
      { ...sample[0]!, id: 'songben' as const, parser: 'missing' },
    ]
    const errors = validateBookRegistry(bad)
    expect(errors.some((item) => item.includes('duplicate'))).toBe(true)
    expect(errors.some((item) => item.includes('unknown parser'))).toBe(true)
  })
})

describe('renderBookTypesModule', () => {
  it('emits BookId union and BOOKS array', () => {
    const source = renderBookTypesModule(sample)
    expect(source).toContain("| 'songben'")
    expect(source).toContain("| 'bencao'")
    expect(source).toContain('export const BOOKS')
    expect(source).toContain('export const CLAUSE_BOOKS')
  })
})

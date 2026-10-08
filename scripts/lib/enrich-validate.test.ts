import { describe, expect, it } from 'vitest'
import { validateLlmEntry } from '../enrich-validate.ts'

describe('validateLlmEntry', () => {
  const input = {
    clauseId: 'funvke-0001',
    contentHash: 'abc123',
    text: '白带……',
    formulas: [
      {
        formulaId: 'f1',
        fangjie: '补益脾土之元，则脾气不湿，何难分消水气。',
        herbs: [
          { herbId: '白术', name: '白术' },
          { herbId: '山药', name: '山药' },
        ],
      },
    ],
  }

  it('accepts valid role with source substring', () => {
    const result = validateLlmEntry(
      {
        clauseId: 'funvke-0001',
        contentHash: 'abc123',
        symptomTags: ['白带'],
        pathogenesisTags: ['脾虚'],
        formulas: [
          {
            formulaId: 'f1',
            herbRoles: [
              {
                herbId: '白术',
                roleText: '健脾',
                sourceSentence: '补益脾土之元，则脾气不湿',
              },
            ],
          },
        ],
      },
      input,
    )
    expect(result.ok.length).toBe(1)
    expect(result.ok[0]!.method).toBe('llm')
  })

  it('rejects herb not in formula', () => {
    const result = validateLlmEntry(
      {
        clauseId: 'funvke-0001',
        contentHash: 'abc123',
        formulas: [
          {
            formulaId: 'f1',
            herbRoles: [
              {
                herbId: '黄连',
                roleText: '清热',
                sourceSentence: '补益脾土之元',
              },
            ],
          },
        ],
      },
      input,
    )
    expect(result.ok.length).toBe(0)
    expect(result.rejects.some((r) => r.includes('herbId not in formula'))).toBe(true)
  })

  it('rejects sourceSentence not in fangjie', () => {
    const result = validateLlmEntry(
      {
        clauseId: 'funvke-0001',
        contentHash: 'abc123',
        formulas: [
          {
            formulaId: 'f1',
            herbRoles: [
              {
                herbId: '白术',
                roleText: '健脾',
                sourceSentence: '这段话方解里没有',
              },
            ],
          },
        ],
      },
      input,
    )
    expect(result.ok.length).toBe(0)
  })
})

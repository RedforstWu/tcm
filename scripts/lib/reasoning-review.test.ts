import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FormulaReasoningInput } from './reasoning.ts'

const formulas = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../data/reasoning/formulas.json'), 'utf8'),
) as FormulaReasoningInput[]

describe('葛根汤校对', () => {
  it('功效与药性按方义校正，并标为已校对', () => {
    const gegen = formulas.find((item) => item.formulaName === '葛根汤')
    expect(gegen?.reviewStatus).toBe('reviewed')
    expect(gegen?.function).toBe('发汗解表，升津舒筋')

    const naturesOf = (name: string) => gegen?.herbs.find((herb) => herb.name === name)?.natures ?? []
    expect(naturesOf('大枣')).not.toContain('热')
    expect(naturesOf('大枣')).not.toContain('降')
    expect(naturesOf('大枣')).toEqual(expect.arrayContaining(['补', '润']))
    for (const name of ['桂枝', '生姜', '芍药', '葛根']) {
      expect(naturesOf(name), name).not.toContain('补')
    }
  })
})

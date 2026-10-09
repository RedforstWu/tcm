import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyErrata, assertErrataEntries, defaultErrataPath, loadErrata, type ErrataEntry } from './errata.ts'

const SONGBEN_RAW_PATH = path.resolve(import.meta.dirname, '../../data/raw/songben-shanghan.wiki')
const SONGBEN_WITNESS_PATH = path.resolve(
  import.meta.dirname,
  '../../data/vendor/jobkoko/tcm/S-003-伤寒论宋版.txt',
)

function makeEntry(overrides: Partial<ErrataEntry> = {}): ErrataEntry {
  return {
    id: 'test-errata-1',
    bookId: 'songben',
    clauseNumber: 172,
    find: '大棗二十枚',
    replace: '大棗十二枚',
    basis: { sourceId: 'jobkoko@4d4aefd', locator: 'S-003-伤寒论宋版.txt#伤寒论(宋本)', quote: '大枣十二枚，擘' },
    note: '测试',
    ...overrides,
  }
}

describe('applyErrata', () => {
  it('replaces the unique occurrence and reports applied entries', () => {
    const raw = '::黃芩三兩　芍藥二兩　甘草二兩（炙）　大棗二十枚（擘）\n::上四味'
    const entry = makeEntry()
    const result = applyErrata(raw, [entry])
    expect(result.text).toBe('::黃芩三兩　芍藥二兩　甘草二兩（炙）　大棗十二枚（擘）\n::上四味')
    expect(result.applied).toEqual([entry])
  })

  it('supports deletion and treats replacement text literally', () => {
    const raw = '大棗十二枚（擘）(君)+四逆散(臣)'
    const deleted = applyErrata(raw, [makeEntry({ find: '(君)+四逆散(臣)', replace: '' })])
    expect(deleted.text).toBe('大棗十二枚（擘）')
    const literal = applyErrata('甲乙', [makeEntry({ find: '乙', replace: '$&$1' })])
    expect(literal.text).toBe('甲$&$1')
  })

  it('applies entries in order against the already corrected text', () => {
    const raw = '::吳茱萸一升（洗）(君)'
    const result = applyErrata(raw, [
      makeEntry({ id: 'junk', find: '(君)', replace: '' }),
      makeEntry({ id: 'heading', find: '::吳茱萸一升（洗）', replace: ':;吳茱萸湯方\n::吳茱萸一升（洗）' }),
    ])
    expect(result.text).toBe(':;吳茱萸湯方\n::吳茱萸一升（洗）')
    expect(result.applied.map((entry) => entry.id)).toEqual(['junk', 'heading'])
  })

  it('throws with the entry id when find is missing', () => {
    expect(() => applyErrata('桂枝三兩', [makeEntry({ id: 'missing-find' })])).toThrow(/missing-find.*0 次/)
  })

  it('throws with the entry id when find occurs more than once', () => {
    expect(() => applyErrata('大棗二十枚；大棗二十枚', [makeEntry({ id: 'twice' })])).toThrow(/twice.*2 次/)
    // 重叠出现同样计数
    expect(() => applyErrata('半半半', [makeEntry({ id: 'overlap', find: '半半', replace: '半' })])).toThrow(
      /overlap.*2 次/,
    )
  })

  it('leaves the text unchanged for an empty table', () => {
    const raw = '太陽之為病，脈浮，頭項強痛而惡寒。'
    expect(applyErrata(raw, [])).toEqual({ text: raw, applied: [] })
  })

  it('throws on duplicate ids', () => {
    const raw = '大棗二十枚；桂技'
    expect(() =>
      applyErrata(raw, [makeEntry({ id: 'dup' }), makeEntry({ id: 'dup', find: '桂技', replace: '桂枝' })]),
    ).toThrow(/id 重复：dup/)
  })
})

describe('assertErrataEntries', () => {
  it('rejects incomplete entries', () => {
    expect(() => assertErrataEntries({})).toThrow(/数组/)
    expect(() => assertErrataEntries([makeEntry({ find: '' })])).toThrow(/find/)
    expect(() => assertErrataEntries([makeEntry({ note: '' })])).toThrow(/note/)
    expect(() => assertErrataEntries([makeEntry({ clauseNumber: 0 })])).toThrow(/clauseNumber/)
    expect(() => assertErrataEntries([makeEntry({ find: '甲', replace: '甲' })])).toThrow(/replace 与 find 相同/)
    const { basis: _basis, ...withoutBasis } = makeEntry()
    expect(() => assertErrataEntries([withoutBasis])).toThrow(/basis/)
    expect(() => assertErrataEntries([makeEntry({ basis: { sourceId: 'x', locator: 'y', quote: '' } })])).toThrow(
      /quote/,
    )
  })

  it('checks bookId when expected', () => {
    expect(() => assertErrataEntries([makeEntry()], 'jingui')).toThrow(/bookId/)
    expect(() => assertErrataEntries([makeEntry()], 'songben')).not.toThrow()
  })
})

describe.skipIf(!existsSync(defaultErrataPath('songben')))('songben errata table', () => {
  it('applies cleanly to the songben wiki', async () => {
    const entries = await loadErrata('songben')
    expect(entries.length).toBeGreaterThan(0)
    const result = applyErrata(readFileSync(SONGBEN_RAW_PATH, 'utf8'), entries)
    expect(result.applied).toHaveLength(entries.length)
    expect(result.text).not.toContain('四逆散(臣)')
    expect(result.text).toContain(':;吳茱萸湯方')
    expect(result.text).not.toContain('桂技')
  })

  it.skipIf(!existsSync(SONGBEN_WITNESS_PATH))('every quote appears verbatim in the S-003 witness', async () => {
    const witnessText = readFileSync(SONGBEN_WITNESS_PATH, 'utf8')
    const entries = await loadErrata('songben')
    expect(entries.filter((entry) => !witnessText.includes(entry.basis.quote)).map((entry) => entry.id)).toEqual([])
  })
})

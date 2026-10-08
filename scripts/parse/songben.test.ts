import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSongbenWiki } from './songben.ts'

describe('songben parser', () => {
  it('parses near 398 clauses and includes guizhi tang 5 herbs', () => {
    const raw = readFileSync(
      path.resolve(import.meta.dirname, '../../data/raw/songben-shanghan.wiki'),
      'utf8',
    )
    const parsed = parseSongbenWiki(raw)
    expect(parsed.clauses.length).toBeGreaterThan(380)
    expect(parsed.clauses.length).toBeLessThan(420)
    const guizhi = parsed.formulas.find((formula) => formula.name === '桂枝汤')
    expect(guizhi).toBeTruthy()
    expect(guizhi!.herbs.map((herb) => herb.name).sort()).toEqual(
      ['大枣', '桂枝', '甘草', '生姜', '芍药'].sort(),
    )
  })
})

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ID_MIGRATIONS_VERSION,
  assertIdMigrationFile,
  buildClauseIdMigration,
  createIdMigrator,
  rewriteIdsDeep,
  type IdMigrationFile,
} from './id-migrations.ts'

const SAMPLE: IdMigrationFile = {
  version: ID_MIGRATIONS_VERSION,
  generatedAt: '2026-10-09T00:00:00.000Z',
  reason: 'test',
  maps: {
    songben: {
      'songben-235': 'songben-234',
      'songben-236': 'songben-235',
      'songben-395': 'songben-393',
    },
  },
  removed: {
    'songben-234': { mergedInto: 'songben-233', kind: 'formula-preparation' },
  },
}

describe('createIdMigrator', () => {
  const migrator = createIdMigrator(SAMPLE)

  it('maps, resolves removed ids and passes unknown ids through', () => {
    expect(migrator.migrateId('songben-235')).toBe('songben-234')
    expect(migrator.migrateId('songben-395')).toBe('songben-393')
    expect(migrator.migrateId('songben-234')).toBe('songben-233')
    expect(migrator.describe('songben-234')).toEqual({
      status: 'removed',
      id: 'songben-233',
      kind: 'formula-preparation',
    })
    expect(migrator.migrateId('songben-1')).toBe('songben-1')
    expect(migrator.migrateId('guilin-235')).toBe('guilin-235')
    expect(migrator.describe('songben-1').status).toBe('unchanged')
  })

  it('never chains mappings', () => {
    // 旧 235 → 新 234；不得再按旧 234（已删除）继续映射到 233
    expect(migrator.migrateId('songben-235')).toBe('songben-234')
    expect(migrator.migrateId('songben-236')).toBe('songben-235')
    expect(migrator.migrateId(migrator.migrateId('songben-236'))).toBe('songben-234')
  })
})

describe('assertIdMigrationFile', () => {
  it('rejects invalid files', () => {
    expect(() => assertIdMigrationFile(null)).toThrow()
    expect(() => assertIdMigrationFile({ ...SAMPLE, version: 2 })).toThrow(/version/)
    expect(() =>
      assertIdMigrationFile({
        ...SAMPLE,
        removed: { 'songben-235': { mergedInto: 'songben-1', kind: 'x' } },
      }),
    ).toThrow(/同时出现/)
    expect(() =>
      assertIdMigrationFile({ ...SAMPLE, maps: { a: { x: 'y' }, b: { x: 'z' } } }),
    ).toThrow(/重复/)
  })
})

describe('rewriteIdsDeep', () => {
  const { migrateId } = createIdMigrator(SAMPLE)

  it('rewrites values and keys in one pass without mutating input', () => {
    const input = {
      clauseIds: ['songben-234', 'songben-235', 'songben-236'],
      nested: [{ from: 'songben-395', note: 'songben-235 mentioned in prose' }],
      byId: { 'songben-236': 1, 'songben-1': 2 },
      count: 3,
      flag: true,
      empty: null,
    }
    const snapshot = JSON.stringify(input)
    const output = rewriteIdsDeep(input, migrateId)
    expect(output).toEqual({
      clauseIds: ['songben-233', 'songben-234', 'songben-235'],
      nested: [{ from: 'songben-393', note: 'songben-235 mentioned in prose' }],
      byId: { 'songben-235': 1, 'songben-1': 2 },
      count: 3,
      flag: true,
      empty: null,
    })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('throws on key collisions and can skip keys', () => {
    const collide = { 'songben-233': 'a', 'songben-234': 'songben-235' }
    expect(() => rewriteIdsDeep(collide, migrateId)).toThrow(/键冲突/)
    expect(rewriteIdsDeep(collide, migrateId, { rewriteKeys: false })).toEqual({
      'songben-233': 'a',
      'songben-234': 'songben-234',
    })
  })
})

describe('buildClauseIdMigration', () => {
  it('aligns by order and records merged fragments', () => {
    const oldClauses = [
      { id: 'b-1', text: 'A' },
      { id: 'b-2', text: 'frag' },
      { id: 'b-3', text: 'B' },
    ]
    const newClauses = [
      { id: 'b-1', text: 'A' },
      { id: 'b-2', text: 'B' },
    ]
    expect(
      buildClauseIdMigration(oldClauses, newClauses, [
        { text: 'frag', mergedInto: 'b-1', kind: 'formula-preparation' },
      ]),
    ).toEqual({
      map: { 'b-3': 'b-2' },
      removed: { 'b-2': { mergedInto: 'b-1', kind: 'formula-preparation' } },
    })
  })

  it('throws on unexplained differences', () => {
    expect(() => buildClauseIdMigration([{ id: 'b-1', text: 'X' }], [{ id: 'b-1', text: 'Y' }], [])).toThrow(
      /无法对齐/,
    )
    expect(() => buildClauseIdMigration([], [{ id: 'b-1', text: 'Y' }], [])).toThrow(/未对齐/)
  })
})

const MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../data/ontology/id-migrations.json')

describe.skipIf(!existsSync(MIGRATIONS_PATH))('data/ontology/id-migrations.json', () => {
  it('restores songben 398 numbering', () => {
    const file: unknown = JSON.parse(readFileSync(MIGRATIONS_PATH, 'utf8'))
    assertIdMigrationFile(file)
    const { migrateId } = createIdMigrator(file)
    expect(Object.keys(file.maps.songben ?? {})).toHaveLength(165)
    expect(file.removed).toEqual({
      'songben-234': { mergedInto: 'songben-233', kind: 'formula-preparation' },
      'songben-394': { mergedInto: 'songben-392', kind: 'formula-preparation' },
    })
    expect(migrateId('songben-233')).toBe('songben-233')
    expect(migrateId('songben-235')).toBe('songben-234')
    expect(migrateId('songben-393')).toBe('songben-392')
    expect(migrateId('songben-395')).toBe('songben-393')
    expect(migrateId('songben-400')).toBe('songben-398')
    const targets = new Set(Object.values(file.maps.songben ?? {}))
    expect(targets.size).toBe(165)
  })
})

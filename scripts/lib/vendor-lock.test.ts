import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  VendorLockError,
  buildCloneUrl,
  buildRawFileUrl,
  compareFileDigest,
  computeFileDigest,
  formatBytes,
  gitBlobSha1,
  isSafeRelativePath,
  parseVendorLock,
  parseVendorLockText,
  resolveFileTarget,
  resolveSourceDir,
  selectSources,
  serializeVendorLock,
  sha256Hex,
  validateVendorLock,
  withPinnedFile,
  type VendorLock,
} from './vendor-lock.ts'

const COMMIT_A = 'e184b49121d290950abdc80b98c9de4b23de7b86'
const COMMIT_B = '4d4aefd805604176541052ae0d8f6f8b0a17a314'
const ROOT = path.resolve('/tmp/tcm-root')

function sampleLock(): VendorLock {
  return {
    version: 1,
    sources: [
      {
        id: 'shanghan-kb',
        kind: 'git-repo',
        repo: 'yanghuide13350/shanghan-lun-knowledge-base',
        branch: 'main',
        commit: COMMIT_A,
        dir: 'data/vendor/shanghan-lun-knowledge-base',
        license: 'none-declared',
        sourceGroup: 'derived',
      },
      {
        id: 'jobkoko',
        kind: 'git-files',
        repo: 'jobkoko/tcm-database',
        branch: 'main',
        commit: COMMIT_B,
        dir: 'data/vendor/jobkoko',
        license: 'none-declared',
        sourceGroup: 'web-simplified',
        files: [{ path: 'tcm/S-003-伤寒论宋版.txt' }, { path: '古籍目录.csv' }],
      },
    ],
  }
}

/** 深拷贝后按需改写，便于构造非法输入 */
function mutate(edit: (draft: Record<string, any>) => void): unknown {
  const draft = JSON.parse(JSON.stringify(sampleLock())) as Record<string, any>
  edit(draft)
  return draft
}

describe('validateVendorLock / parseVendorLock', () => {
  it('合法 lock 通过', () => {
    expect(validateVendorLock(sampleLock())).toEqual([])
    expect(parseVendorLock(sampleLock()).sources).toHaveLength(2)
  })

  it('根节点、version、sources 非法时报错', () => {
    expect(validateVendorLock(null)).toEqual(['根节点必须是对象'])
    expect(validateVendorLock([])).toEqual(['根节点必须是对象'])
    expect(validateVendorLock(mutate((draft) => (draft.version = 2)))).toContain('version 必须为 1')
    expect(validateVendorLock(mutate((draft) => (draft.sources = [])))).toContain('sources 必须是非空数组')
  })

  it.each([
    'id',
    'kind',
    'repo',
    'branch',
    'commit',
    'dir',
    'license',
    'sourceGroup',
  ])('缺少字段 %s 时报错', (field) => {
    const problems = validateVendorLock(mutate((draft) => delete draft.sources[0][field]))
    expect(problems.some((problem) => problem.includes(`.${field}`))).toBe(true)
  })

  it('git-files 缺少 files 或 files 为空时报错', () => {
    expect(validateVendorLock(mutate((draft) => delete draft.sources[1].files)).join()).toContain('files 必须是非空数组')
    expect(validateVendorLock(mutate((draft) => (draft.sources[1].files = []))).join()).toContain('files 必须是非空数组')
  })

  it('git-repo 不允许带 files', () => {
    const problems = validateVendorLock(mutate((draft) => (draft.sources[0].files = [{ path: 'a.txt' }])))
    expect(problems.join()).toContain('仅允许出现在 git-files')
  })

  it('拒绝非法 commit、sha256、bytes、gitBlobSha', () => {
    const problems = validateVendorLock(
      mutate((draft) => {
        draft.sources[0].commit = 'E184B49'
        draft.sources[1].files[0].sha256 = 'abc'
        draft.sources[1].files[0].bytes = -1
        draft.sources[1].files[0].gitBlobSha = 'xyz'
      }),
    )
    expect(problems.join('\n')).toMatch(/commit/)
    expect(problems.join('\n')).toMatch(/sha256/)
    expect(problems.join('\n')).toMatch(/bytes/)
    expect(problems.join('\n')).toMatch(/gitBlobSha/)
  })

  it('拒绝未知 kind 与 sourceGroup', () => {
    const problems = validateVendorLock(
      mutate((draft) => {
        draft.sources[0].kind = 'tarball'
        draft.sources[0].sourceGroup = 'unknown'
      }),
    )
    expect(problems.join()).toContain('.kind')
    expect(problems.join()).toContain('.sourceGroup')
  })

  it('拒绝重复 id 与重叠目录', () => {
    const problems = validateVendorLock(
      mutate((draft) => {
        draft.sources[1].id = 'shanghan-kb'
        draft.sources[1].dir = 'data/vendor/shanghan-lun-knowledge-base/sub'
      }),
    )
    expect(problems.join()).toContain('id 重复')
    expect(problems.join()).toContain('目录重叠')
  })

  it('拒绝重复文件路径', () => {
    const problems = validateVendorLock(mutate((draft) => (draft.sources[1].files[1].path = 'tcm/S-003-伤寒论宋版.txt')))
    expect(problems.join()).toContain('path 重复')
  })

  it.each([
    ['../outside', 'dir 越界'],
    ['data/vendor', 'dir 等于 vendor 根'],
    ['data/other/x', 'dir 不在 vendor 下'],
    ['data\\vendor\\x', '反斜杠'],
    ['/data/vendor/x', '绝对路径'],
  ])('拒绝非法 dir：%s（%s）', (dir) => {
    const problems = validateVendorLock(mutate((draft) => (draft.sources[0].dir = dir)))
    expect(problems.join()).toContain('.dir')
  })

  it('拒绝可被当作 git 选项或含 .. 的 branch、非法 repo', () => {
    const problems = validateVendorLock(
      mutate((draft) => {
        draft.sources[0].branch = '--upload-pack=evil'
        draft.sources[1].branch = 'a..b'
        draft.sources[1].repo = 'not a repo'
      }),
    )
    expect(problems.filter((problem) => problem.includes('.branch'))).toHaveLength(2)
    expect(problems.join()).toContain('.repo')
  })

  it('parseVendorLock 失败抛出 VendorLockError 并携带全部问题', () => {
    const bad = mutate((draft) => {
      delete draft.sources[0].license
      delete draft.sources[1].commit
    })
    expect(() => parseVendorLock(bad)).toThrow(VendorLockError)
    try {
      parseVendorLock(bad)
    } catch (error) {
      expect((error as VendorLockError).problems).toHaveLength(2)
    }
  })

  it('parseVendorLockText 处理 JSON 语法错误', () => {
    expect(() => parseVendorLockText('{ not json')).toThrow(/JSON 解析失败/)
    expect(parseVendorLockText(serializeVendorLock(sampleLock())).sources[0]!.id).toBe('shanghan-kb')
  })
})

describe('isSafeRelativePath', () => {
  it.each(['a.txt', 'tcm/S-003-伤寒论宋版.txt', 'KR3e0007@SBCK/x'])('接受 %s', (value) => {
    expect(isSafeRelativePath(value)).toBe(true)
  })

  it.each(['', '/a', 'C:/a', 'a\\b', 'a/../b', './a', 'a//b', 'a/', 'a\u0000b', 'a\nb'])('拒绝 %j', (value) => {
    expect(isSafeRelativePath(value)).toBe(false)
  })
})

describe('selectSources', () => {
  it('空 ids 返回全部，指定 ids 按入参顺序去重返回', () => {
    const lock = sampleLock()
    expect(selectSources(lock, [])).toHaveLength(2)
    expect(selectSources(lock, ['jobkoko', 'shanghan-kb', 'jobkoko']).map((source) => source.id)).toEqual([
      'jobkoko',
      'shanghan-kb',
    ])
  })

  it('未知 id 报错并列出可选项', () => {
    expect(() => selectSources(sampleLock(), ['nope'])).toThrow(/未知来源 id：nope.*shanghan-kb, jobkoko/)
  })
})

describe('路径计算', () => {
  it('resolveSourceDir 返回 vendor 下的绝对路径', () => {
    const [shanghan] = sampleLock().sources
    expect(resolveSourceDir(ROOT, shanghan!)).toBe(path.join(ROOT, 'data', 'vendor', 'shanghan-lun-knowledge-base'))
  })

  it('resolveFileTarget 保留仓库内子目录', () => {
    const jobkoko = sampleLock().sources[1]!
    expect(resolveFileTarget(ROOT, jobkoko, 'tcm/S-003-伤寒论宋版.txt')).toBe(
      path.join(ROOT, 'data', 'vendor', 'jobkoko', 'tcm', 'S-003-伤寒论宋版.txt'),
    )
  })

  it('越界 dir 与文件路径抛错', () => {
    const jobkoko = sampleLock().sources[1]!
    expect(() => resolveSourceDir(ROOT, { id: 'x', dir: 'data/vendor/../../etc' })).toThrow(/dir 非法/)
    expect(() => resolveFileTarget(ROOT, jobkoko, '../escape.txt')).toThrow(/文件路径非法/)
  })
})

describe('URL 构造', () => {
  it('buildCloneUrl', () => {
    expect(buildCloneUrl('kanripo/KR3e0007')).toBe('https://github.com/kanripo/KR3e0007.git')
    expect(() => buildCloneUrl('a/b/c')).toThrow()
  })

  it('buildRawFileUrl 逐段编码中文路径、保留分隔符', () => {
    expect(buildRawFileUrl('jobkoko/tcm-database', COMMIT_B, 'tcm/S-003-伤寒论宋版.txt')).toBe(
      `https://raw.githubusercontent.com/jobkoko/tcm-database/${COMMIT_B}/tcm/S-003-%E4%BC%A4%E5%AF%92%E8%AE%BA%E5%AE%8B%E7%89%88.txt`,
    )
    expect(buildRawFileUrl('jobkoko/tcm-database', COMMIT_B, 'a b#c.csv')).toMatch(/\/a%20b%23c\.csv$/)
  })

  it('buildRawFileUrl 拒绝非法 commit 与路径', () => {
    expect(() => buildRawFileUrl('jobkoko/tcm-database', 'main', 'a.txt')).toThrow(/commit/)
    expect(() => buildRawFileUrl('jobkoko/tcm-database', COMMIT_B, '../a.txt')).toThrow(/路径/)
  })
})

describe('摘要与比对', () => {
  const data = new TextEncoder().encode('hello\n')

  it('sha256Hex 与 gitBlobSha1 与标准值一致', () => {
    expect(sha256Hex(data)).toBe('5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03')
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha1(data)).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('compareFileDigest 只比较 lock 中已记录的字段', () => {
    const digest = computeFileDigest(data)
    expect(compareFileDigest({ path: 'a' }, digest)).toEqual([])
    expect(compareFileDigest({ path: 'a', ...digest }, digest)).toEqual([])
    expect(compareFileDigest({ path: 'a', sha256: digest.sha256.toUpperCase() }, digest)).toEqual([])
  })

  it('compareFileDigest 报告每个不一致字段', () => {
    const digest = computeFileDigest(data)
    const mismatches = compareFileDigest(
      { path: 'a', sha256: '0'.repeat(64), bytes: 1, gitBlobSha: '0'.repeat(40) },
      digest,
    )
    expect(mismatches).toHaveLength(3)
    expect(mismatches.join()).toContain('bytes 期望 1，实际 6')
  })
})

describe('withPinnedFile', () => {
  it('写入 sha256/bytes 且不修改原对象', () => {
    const lock = sampleLock()
    const pinned = withPinnedFile(lock, 'jobkoko', '古籍目录.csv', { sha256: 'a'.repeat(64), bytes: 10 })
    const pinnedFiles = pinned.sources[1]!.kind === 'git-files' ? pinned.sources[1]!.files : []
    expect(pinnedFiles[1]).toEqual({ path: '古籍目录.csv', sha256: 'a'.repeat(64), bytes: 10 })
    const originalFiles = lock.sources[1]!.kind === 'git-files' ? lock.sources[1]!.files : []
    expect(originalFiles[1]!.sha256).toBeUndefined()
    expect(validateVendorLock(pinned)).toEqual([])
  })

  it('不存在的来源或文件抛错', () => {
    expect(() => withPinnedFile(sampleLock(), 'jobkoko', 'missing.txt', { sha256: 'a'.repeat(64), bytes: 1 })).toThrow()
    expect(() => withPinnedFile(sampleLock(), 'shanghan-kb', 'a.txt', { sha256: 'a'.repeat(64), bytes: 1 })).toThrow()
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [131712, '128.6 KB'],
    [3 * 1024 * 1024, '3.0 MB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('仓库内 sources.lock.json', () => {
  const lockPath = path.resolve(import.meta.dirname, '../../data/vendor/sources.lock.json')

  it.skipIf(!existsSync(lockPath))('通过校验且单文件均已 pin sha256', () => {
    const lock = parseVendorLockText(readFileSync(lockPath, 'utf8'))
    for (const source of lock.sources) {
      if (source.kind !== 'git-files') continue
      for (const file of source.files) {
        expect(file.sha256, `${source.id}:${file.path}`).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })
})

/**
 * 外部来源锁定文件（data/vendor/sources.lock.json）的读取、校验与路径计算。
 * 本模块只含纯函数，不做 I/O；下载与 git 操作见 scripts/vendor-sources.ts。
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { SourceGroup } from '../../src/types/data.ts'

export const VENDOR_LOCK_VERSION = 1
/** 所有 vendor 目录必须位于此前缀之下（相对仓库根，POSIX 分隔符） */
export const VENDOR_ROOT = 'data/vendor'
export const VENDOR_LOCK_RELATIVE_PATH = `${VENDOR_ROOT}/sources.lock.json`

export const VENDOR_SOURCE_KINDS = ['git-repo', 'git-files'] as const
export type VendorSourceKind = (typeof VENDOR_SOURCE_KINDS)[number]

export const VENDOR_SOURCE_GROUPS = [
  'wikisource',
  'kanripo',
  'web-simplified',
  'derived',
] as const satisfies readonly SourceGroup[]

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
/** 分支名：禁止以 `-` 开头（防止被 git 当作选项），禁止 `..` */
const BRANCH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/
const FIRST_PRINTABLE_CHAR_CODE = 0x20
const DELETE_CHAR_CODE = 0x7f

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < FIRST_PRINTABLE_CHAR_CODE || code === DELETE_CHAR_CODE) return true
  }
  return false
}

export interface VendorFileEntry {
  /** 仓库内相对路径（POSIX 分隔符），下载后保存在 `<dir>/<path>` */
  path: string
  /** 下载内容的 sha256（小写十六进制）；缺失时需用 `--pin` 首次写入 */
  sha256?: string
  /** 文件字节数 */
  bytes?: number
  /** GitHub contents API 给出的 git blob sha1，用于在首次 pin 时交叉校验 */
  gitBlobSha?: string
}

interface VendorSourceBase {
  id: string
  title?: string
  /** GitHub `owner/name` */
  repo: string
  branch: string
  /** 锁定的 40 位 commit SHA */
  commit: string
  /** 相对仓库根的目标目录，必须位于 data/vendor/ 之下 */
  dir: string
  license: string
  sourceGroup: SourceGroup
}

export interface GitRepoSource extends VendorSourceBase {
  kind: 'git-repo'
}

export interface GitFilesSource extends VendorSourceBase {
  kind: 'git-files'
  files: VendorFileEntry[]
}

export type VendorSource = GitRepoSource | GitFilesSource

export interface VendorLock {
  version: typeof VENDOR_LOCK_VERSION
  note?: string
  sources: VendorSource[]
}

export class VendorLockError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`sources.lock.json 校验失败：\n  - ${problems.join('\n  - ')}`)
    this.name = 'VendorLockError'
    this.problems = problems
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 相对路径安全检查：POSIX 分隔符、非绝对、无 `.`/`..`/空段、无控制字符 */
export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  if (hasControlChar(value)) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA_PATTERN.test(value)
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

function isVendorDir(value: unknown): value is string {
  return isSafeRelativePath(value) && value.startsWith(`${VENDOR_ROOT}/`)
}

function dirsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function validateFiles(files: unknown, label: string, problems: string[]): void {
  if (!Array.isArray(files) || files.length === 0) {
    problems.push(`${label}.files 必须是非空数组`)
    return
  }
  const seenPaths = new Set<string>()
  files.forEach((file, fileIndex) => {
    const fileLabel = `${label}.files[${fileIndex}]`
    if (!isRecord(file)) {
      problems.push(`${fileLabel} 必须是对象`)
      return
    }
    if (!isSafeRelativePath(file.path)) {
      problems.push(`${fileLabel}.path 缺失或不是安全的相对路径`)
    } else if (seenPaths.has(file.path)) {
      problems.push(`${fileLabel}.path 重复：${file.path}`)
    } else {
      seenPaths.add(file.path)
    }
    if (file.sha256 !== undefined && !isSha256Hex(file.sha256)) {
      problems.push(`${fileLabel}.sha256 必须是 64 位小写十六进制`)
    }
    if (file.bytes !== undefined && !(Number.isSafeInteger(file.bytes) && (file.bytes as number) >= 0)) {
      problems.push(`${fileLabel}.bytes 必须是非负整数`)
    }
    if (file.gitBlobSha !== undefined && !isCommitSha(file.gitBlobSha)) {
      problems.push(`${fileLabel}.gitBlobSha 必须是 40 位小写十六进制`)
    }
  })
}

/** 返回全部问题列表；空数组表示通过 */
export function validateVendorLock(input: unknown): string[] {
  const problems: string[] = []
  if (!isRecord(input)) return ['根节点必须是对象']
  if (input.version !== VENDOR_LOCK_VERSION) {
    problems.push(`version 必须为 ${VENDOR_LOCK_VERSION}`)
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    problems.push('sources 必须是非空数组')
    return problems
  }

  const seenIds = new Set<string>()
  const seenDirs: Array<{ id: string; dir: string }> = []
  input.sources.forEach((source, index) => {
    if (!isRecord(source)) {
      problems.push(`sources[${index}] 必须是对象`)
      return
    }
    const label = `sources[${index}]${typeof source.id === 'string' ? `(${source.id})` : ''}`

    if (!isNonEmptyString(source.id) || !SOURCE_ID_PATTERN.test(source.id)) {
      problems.push(`${label}.id 缺失或含非法字符`)
    } else if (seenIds.has(source.id)) {
      problems.push(`${label}.id 重复`)
    } else {
      seenIds.add(source.id)
    }

    if (!VENDOR_SOURCE_KINDS.includes(source.kind as VendorSourceKind)) {
      problems.push(`${label}.kind 必须是 ${VENDOR_SOURCE_KINDS.join(' | ')}`)
    }
    if (!isNonEmptyString(source.repo) || !GITHUB_REPO_PATTERN.test(source.repo) || source.repo.includes('..')) {
      problems.push(`${label}.repo 必须是 GitHub owner/name`)
    }
    if (!isNonEmptyString(source.branch) || !BRANCH_PATTERN.test(source.branch) || source.branch.includes('..')) {
      problems.push(`${label}.branch 缺失或非法`)
    }
    if (!isCommitSha(source.commit)) {
      problems.push(`${label}.commit 必须是 40 位小写十六进制 SHA`)
    }
    if (!isVendorDir(source.dir)) {
      problems.push(`${label}.dir 必须是 ${VENDOR_ROOT}/ 下的安全相对路径`)
    } else {
      const clash = seenDirs.find((item) => dirsOverlap(item.dir, source.dir as string))
      if (clash) {
        problems.push(`${label}.dir 与 ${clash.id} 的目录重叠：${source.dir}`)
      }
      seenDirs.push({ id: String(source.id), dir: source.dir })
    }
    if (!isNonEmptyString(source.license)) {
      problems.push(`${label}.license 缺失`)
    }
    if (!VENDOR_SOURCE_GROUPS.includes(source.sourceGroup as SourceGroup)) {
      problems.push(`${label}.sourceGroup 必须是 ${VENDOR_SOURCE_GROUPS.join(' | ')}`)
    }
    if (source.title !== undefined && typeof source.title !== 'string') {
      problems.push(`${label}.title 必须是字符串`)
    }

    if (source.kind === 'git-files') {
      validateFiles(source.files, label, problems)
    } else if (source.kind === 'git-repo' && source.files !== undefined) {
      problems.push(`${label}.files 仅允许出现在 git-files 条目中`)
    }
  })
  return problems
}

/** 校验并返回类型化的 lock；失败抛出 VendorLockError（含全部问题） */
export function parseVendorLock(input: unknown): VendorLock {
  const problems = validateVendorLock(input)
  if (problems.length > 0) throw new VendorLockError(problems)
  return input as VendorLock
}

/** 从 JSON 文本解析 lock；JSON 语法错误同样转为 VendorLockError */
export function parseVendorLockText(text: string): VendorLock {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new VendorLockError([`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`])
  }
  return parseVendorLock(parsed)
}

export function serializeVendorLock(lock: VendorLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`
}

/** 按 id 选取来源；ids 为空时返回全部；存在未知 id 时抛错 */
export function selectSources(lock: VendorLock, ids: readonly string[]): VendorSource[] {
  if (ids.length === 0) return lock.sources
  const known = new Map(lock.sources.map((source) => [source.id, source]))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw new Error(`未知来源 id：${unknown.join(', ')}；可选：${[...known.keys()].join(', ')}`)
  }
  return [...new Set(ids)].map((id) => known.get(id)!)
}

function assertInside(parentAbs: string, childAbs: string, description: string): void {
  const relative = path.relative(parentAbs, childAbs)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${description} 越出 ${parentAbs}：${childAbs}`)
  }
}

/** 来源目标目录的绝对路径；保证位于 <root>/data/vendor 之内 */
export function resolveSourceDir(projectRootAbs: string, source: Pick<VendorSource, 'id' | 'dir'>): string {
  if (!isVendorDir(source.dir)) {
    throw new Error(`来源 ${source.id} 的 dir 非法：${source.dir}`)
  }
  const vendorRootAbs = path.resolve(projectRootAbs, ...VENDOR_ROOT.split('/'))
  const dirAbs = path.resolve(projectRootAbs, ...source.dir.split('/'))
  assertInside(vendorRootAbs, dirAbs, `来源 ${source.id} 的目录`)
  return dirAbs
}

/** 单文件下载的目标绝对路径：`<dir>/<filePath>`，保证不越出来源目录 */
export function resolveFileTarget(
  projectRootAbs: string,
  source: Pick<VendorSource, 'id' | 'dir'>,
  filePath: string,
): string {
  if (!isSafeRelativePath(filePath)) {
    throw new Error(`来源 ${source.id} 的文件路径非法：${filePath}`)
  }
  const dirAbs = resolveSourceDir(projectRootAbs, source)
  const targetAbs = path.resolve(dirAbs, ...filePath.split('/'))
  assertInside(dirAbs, targetAbs, `来源 ${source.id} 的文件`)
  return targetAbs
}

export function buildCloneUrl(repo: string): string {
  if (!GITHUB_REPO_PATTERN.test(repo)) throw new Error(`非法 repo：${repo}`)
  return `https://github.com/${repo}.git`
}

/** raw.githubusercontent.com 下载地址；逐段 URL 编码（支持中文路径） */
export function buildRawFileUrl(repo: string, commit: string, filePath: string): string {
  if (!GITHUB_REPO_PATTERN.test(repo)) throw new Error(`非法 repo：${repo}`)
  if (!isCommitSha(commit)) throw new Error(`非法 commit：${commit}`)
  if (!isSafeRelativePath(filePath)) throw new Error(`非法文件路径：${filePath}`)
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${repo}/${commit}/${encodedPath}`
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 与 `git hash-object` 相同的 blob sha1 */
export function gitBlobSha1(data: Uint8Array): string {
  return createHash('sha1').update(`blob ${data.byteLength}\0`).update(data).digest('hex')
}

export interface FileDigest {
  sha256: string
  bytes: number
  gitBlobSha: string
}

export function computeFileDigest(data: Uint8Array): FileDigest {
  return { sha256: sha256Hex(data), bytes: data.byteLength, gitBlobSha: gitBlobSha1(data) }
}

/**
 * 对比 lock 中记录的期望值与实际摘要；只比较 lock 中已记录的字段。
 * 返回不一致描述列表，空数组表示通过。
 */
export function compareFileDigest(expected: VendorFileEntry, actual: FileDigest): string[] {
  const mismatches: string[] = []
  if (expected.bytes !== undefined && expected.bytes !== actual.bytes) {
    mismatches.push(`bytes 期望 ${expected.bytes}，实际 ${actual.bytes}`)
  }
  if (expected.gitBlobSha !== undefined && expected.gitBlobSha.toLowerCase() !== actual.gitBlobSha) {
    mismatches.push(`gitBlobSha 期望 ${expected.gitBlobSha}，实际 ${actual.gitBlobSha}`)
  }
  if (expected.sha256 !== undefined && expected.sha256.toLowerCase() !== actual.sha256) {
    mismatches.push(`sha256 期望 ${expected.sha256}，实际 ${actual.sha256}`)
  }
  return mismatches
}

/** 返回写入了 sha256/bytes 的新 lock（不修改入参） */
export function withPinnedFile(
  lock: VendorLock,
  sourceId: string,
  filePath: string,
  digest: Pick<FileDigest, 'sha256' | 'bytes'>,
): VendorLock {
  let found = false
  const sources = lock.sources.map((source) => {
    if (source.id !== sourceId || source.kind !== 'git-files') return source
    const files = source.files.map((file) => {
      if (file.path !== filePath) return file
      found = true
      return { ...file, sha256: digest.sha256, bytes: digest.bytes }
    })
    return { ...source, files }
  })
  if (!found) throw new Error(`lock 中不存在 ${sourceId}:${filePath}`)
  return { ...lock, sources }
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const
const BYTES_PER_UNIT = 1024

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`
  let value = bytes
  let unitIndex = 0
  while (value >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT
    unitIndex += 1
  }
  return unitIndex === 0 ? `${bytes} B` : `${value.toFixed(1)} ${BYTE_UNITS[unitIndex]}`
}

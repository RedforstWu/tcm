/**
 * 按 data/vendor/sources.lock.json 把外部来源下载到 data/vendor/<dir>/，可复现、幂等。
 *
 * 用法：
 *   npx tsx scripts/vendor-sources.ts            # 全部来源
 *   npx tsx scripts/vendor-sources.ts jobkoko    # 仅指定 id（可多个）
 *   npx tsx scripts/vendor-sources.ts --pin      # 为缺少 sha256 的单文件写入 sha256（须通过 gitBlobSha 交叉校验）
 *
 * 规则：
 * - git-repo：目录已存在且 HEAD 等于 lock commit 时跳过；HEAD 不一致或不是 git 仓库时报错，绝不删除已有目录。
 *   新克隆先进临时目录，`git rev-parse HEAD` 核对一致后再改名为目标目录。
 * - git-files：按 commit 从 raw.githubusercontent.com 下载，校验 bytes/gitBlobSha/sha256 后
 *   先写临时文件再改名；校验失败不落盘。
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileExists, projectRoot, readText, writeText } from './lib/fs-utils.ts'
import {
  VENDOR_LOCK_RELATIVE_PATH,
  buildCloneUrl,
  buildRawFileUrl,
  compareFileDigest,
  computeFileDigest,
  formatBytes,
  parseVendorLockText,
  resolveFileTarget,
  resolveSourceDir,
  selectSources,
  serializeVendorLock,
  withPinnedFile,
  type GitFilesSource,
  type GitRepoSource,
  type VendorLock,
  type VendorSource,
} from './lib/vendor-lock.ts'

const execFileAsync = promisify(execFile)

const LOG_PREFIX = '[vendor]'
const DOWNLOAD_MAX_ATTEMPTS = 3
const DOWNLOAD_RETRY_BASE_MS = 1500
const DOWNLOAD_TIMEOUT_MS = 60_000
/** 单文件下载上限，防止异常响应占满磁盘/内存 */
const DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024
const GIT_TIMEOUT_MS = 10 * 60_000
const GIT_MAX_BUFFER_BYTES = 16 * 1024 * 1024
const USER_AGENT = 'tcm-jingfang-learn/0.1 vendor-sources (educational research)'

interface CliOptions {
  ids: string[]
  pin: boolean
}

type FileStatus = 'downloaded' | 'pinned' | 'up-to-date'

interface FileReport {
  sourceId: string
  path: string
  bytes: number
  sha256: string
  status: FileStatus
}

interface SourceReport {
  id: string
  ok: boolean
  message: string
  files: FileReport[]
}

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`)
}

function warn(message: string): void {
  console.warn(`${LOG_PREFIX} 警告：${message}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function printUsage(): void {
  console.log(
    [
      '用法：npx tsx scripts/vendor-sources.ts [id...] [--pin]',
      '  id      只抓取 lock 中指定 id 的来源（默认全部）',
      '  --pin   为缺少 sha256 的单文件写入 sha256 到 lock（须先通过 gitBlobSha/bytes 校验）',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): CliOptions | null {
  const options: CliOptions = { ids: [], pin: false }
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') return null
    if (arg === '--pin') {
      options.pin = true
      continue
    }
    if (arg.startsWith('-')) throw new Error(`未知选项：${arg}`)
    options.ids.push(arg)
  }
  return options
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return stdout.trim()
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new Error(`git ${args.join(' ')} 失败：${stderr || errorMessage(error)}`)
  }
}

/** 统计目录（不含 .git）的文件数与总字节数 */
async function measureTree(dirAbs: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  const entries = await readdir(dirAbs, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const entryAbs = path.join(dirAbs, entry.name)
    if (entry.isDirectory()) {
      const nested = await measureTree(entryAbs)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += (await stat(entryAbs)).size
    }
  }
  return { files, bytes }
}

async function vendorGitRepo(root: string, source: GitRepoSource): Promise<SourceReport> {
  const dirAbs = resolveSourceDir(root, source)

  if (await fileExists(dirAbs)) {
    // 必须检查目录自身的 .git，否则 git 会向上找到外层 tcm 仓库
    if (!(await fileExists(path.join(dirAbs, '.git')))) {
      throw new Error(`${source.dir} 已存在但不是独立 git 仓库；脚本不会删除已有目录，请人工处理`)
    }
    const head = await runGit(['rev-parse', 'HEAD'], dirAbs)
    if (head !== source.commit) {
      throw new Error(
        `${source.dir} 已存在但 HEAD=${head} 与 lock commit ${source.commit} 不一致；脚本不会删除已有目录，请人工确认后处理`,
      )
    }
    const dirty = await runGit(['status', '--porcelain'], dirAbs)
    if (dirty) warn(`${source.dir} 有未提交的本地改动（HEAD 正确，仍跳过）`)
    const tree = await measureTree(dirAbs)
    return {
      id: source.id,
      ok: true,
      message: `已是目标 commit ${source.commit.slice(0, 12)}，跳过（${tree.files} 个文件，${formatBytes(tree.bytes)}）`,
      files: [],
    }
  }

  const tmpAbs = `${dirAbs}.tmp-${process.pid}`
  await mkdir(path.dirname(dirAbs), { recursive: true })
  await rm(tmpAbs, { recursive: true, force: true })
  try {
    log(`${source.id}: git clone --depth 1 --branch ${source.branch} ${source.repo}`)
    await runGit([
      'clone',
      '--depth',
      '1',
      '--branch',
      source.branch,
      '--single-branch',
      '--config',
      'core.autocrlf=false',
      '--',
      buildCloneUrl(source.repo),
      tmpAbs,
    ])
    const head = await runGit(['rev-parse', 'HEAD'], tmpAbs)
    if (head !== source.commit) {
      throw new Error(
        `${source.repo}@${source.branch} 当前 HEAD=${head}，与 lock commit ${source.commit} 不一致（上游分支可能已更新；确认后更新 lock）`,
      )
    }
    await rename(tmpAbs, dirAbs)
  } catch (error) {
    await rm(tmpAbs, { recursive: true, force: true }).catch((cleanupError: unknown) => {
      warn(`清理临时目录 ${tmpAbs} 失败：${errorMessage(cleanupError)}`)
    })
    throw error
  }

  const tree = await measureTree(dirAbs)
  return {
    id: source.id,
    ok: true,
    message: `已克隆 ${source.commit.slice(0, 12)} → ${source.dir}（${tree.files} 个文件，${formatBytes(tree.bytes)}）`,
    files: [],
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function downloadOnce(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declaredLength) && declaredLength > DOWNLOAD_MAX_BYTES) {
    throw new Error(`响应过大：${declaredLength} 字节 > 上限 ${DOWNLOAD_MAX_BYTES}`)
  }
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > DOWNLOAD_MAX_BYTES) {
    throw new Error(`响应过大：${data.byteLength} 字节 > 上限 ${DOWNLOAD_MAX_BYTES}`)
  }
  return data
}

async function downloadWithRetry(url: string): Promise<Uint8Array> {
  let lastError: unknown
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await downloadOnce(url)
    } catch (error) {
      lastError = error
      warn(`下载失败（${attempt}/${DOWNLOAD_MAX_ATTEMPTS}）${url}：${errorMessage(error)}`)
      if (attempt < DOWNLOAD_MAX_ATTEMPTS) await sleep(DOWNLOAD_RETRY_BASE_MS * attempt)
    }
  }
  throw new Error(`下载失败：${url}：${errorMessage(lastError)}`)
}

/** 先写临时文件再改名；Windows 上目标存在导致 rename 失败时先删目标再改名 */
async function writeFileAtomically(targetAbs: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(targetAbs), { recursive: true })
  const tmpAbs = `${targetAbs}.download-${process.pid}.tmp`
  try {
    await writeFile(tmpAbs, data)
    try {
      await rename(tmpAbs, targetAbs)
    } catch {
      await unlink(targetAbs).catch(() => undefined)
      await rename(tmpAbs, targetAbs)
    }
  } catch (error) {
    await unlink(tmpAbs).catch(() => undefined)
    throw error
  }
}

interface GitFilesResult {
  report: SourceReport
  lock: VendorLock
}

async function vendorGitFiles(
  root: string,
  source: GitFilesSource,
  lock: VendorLock,
  pin: boolean,
): Promise<GitFilesResult> {
  let nextLock = lock
  const files: FileReport[] = []

  for (const file of source.files) {
    const targetAbs = resolveFileTarget(root, source, file.path)
    const label = `${source.id}:${file.path}`

    if (file.sha256 && (await fileExists(targetAbs))) {
      const existing = computeFileDigest(await readFile(targetAbs))
      const mismatches = compareFileDigest(file, existing)
      if (mismatches.length === 0) {
        log(`${label} 已存在且校验通过，跳过（${formatBytes(existing.bytes)}）`)
        files.push({ sourceId: source.id, path: file.path, bytes: existing.bytes, sha256: existing.sha256, status: 'up-to-date' })
        continue
      }
      warn(`${label} 本地文件校验不符（${mismatches.join('；')}），重新下载`)
    }

    if (!file.sha256 && !pin) {
      throw new Error(`${label} 在 lock 中缺少 sha256；确认来源后使用 --pin 写入`)
    }

    const url = buildRawFileUrl(source.repo, source.commit, file.path)
    log(`${label} 下载 ${url}`)
    const data = await downloadWithRetry(url)
    const digest = computeFileDigest(data)
    const mismatches = compareFileDigest(file, digest)
    if (mismatches.length > 0) {
      throw new Error(`${label} 校验失败，未写入：${mismatches.join('；')}`)
    }

    let status: FileStatus = 'downloaded'
    if (!file.sha256) {
      if (!file.gitBlobSha) {
        warn(`${label} 无 gitBlobSha 可交叉校验，sha256 按首次下载结果信任写入`)
      }
      nextLock = withPinnedFile(nextLock, source.id, file.path, digest)
      status = 'pinned'
    }

    await writeFileAtomically(targetAbs, data)
    log(`${label} 已写入（${formatBytes(digest.bytes)}，sha256 ${digest.sha256}）`)
    files.push({ sourceId: source.id, path: file.path, bytes: digest.bytes, sha256: digest.sha256, status })
  }

  return {
    report: { id: source.id, ok: true, message: `${files.length} 个文件就绪 @ ${source.commit.slice(0, 12)}`, files },
    lock: nextLock,
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    printUsage()
    return 0
  }

  const root = projectRoot()
  const lockAbs = path.resolve(root, ...VENDOR_LOCK_RELATIVE_PATH.split('/'))
  if (!(await fileExists(lockAbs))) {
    throw new Error(`找不到 lock 文件：${lockAbs}`)
  }
  const lock = parseVendorLockText(await readText(lockAbs))
  const sources: VendorSource[] = selectSources(lock, options.ids)
  log(`lock：${VENDOR_LOCK_RELATIVE_PATH}，本次处理 ${sources.map((source) => source.id).join(', ')}`)

  let currentLock = lock
  const reports: SourceReport[] = []
  for (const source of sources) {
    log(`${source.id}（${source.kind}，${source.repo}@${source.branch} ${source.commit.slice(0, 12)}）...`)
    try {
      if (source.kind === 'git-repo') {
        reports.push(await vendorGitRepo(root, source))
      } else {
        const result = await vendorGitFiles(root, source, currentLock, options.pin)
        currentLock = result.lock
        reports.push(result.report)
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} 错误：${source.id}：${errorMessage(error)}`)
      reports.push({ id: source.id, ok: false, message: errorMessage(error), files: [] })
    }
  }

  if (currentLock !== lock) {
    await writeText(lockAbs, serializeVendorLock(currentLock))
    log(`已把新 pin 的 sha256 写回 ${VENDOR_LOCK_RELATIVE_PATH}`)
  }

  console.log(`\n${LOG_PREFIX} 汇总：`)
  for (const report of reports) {
    console.log(`  ${report.ok ? 'OK  ' : 'FAIL'} ${report.id}：${report.message}`)
    for (const file of report.files) {
      console.log(`         ${file.status.padEnd(10)} ${String(file.bytes).padStart(9)} B  ${file.sha256}  ${file.path}`)
    }
  }
  const failed = reports.filter((report) => !report.ok)
  if (failed.length > 0) {
    console.error(`${LOG_PREFIX} ${failed.length} 个来源失败：${failed.map((report) => report.id).join(', ')}`)
    return 1
  }
  return 0
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode
  })
  .catch((error: unknown) => {
    console.error(`${LOG_PREFIX} 致命错误：${errorMessage(error)}`)
    process.exitCode = 1
  })

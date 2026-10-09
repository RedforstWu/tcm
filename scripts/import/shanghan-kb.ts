import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileExists, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import {
  KB_CONTENT_DIR,
  KB_LICENSE,
  KB_PINNED_COMMIT,
  KB_SECTION_KEYS,
  KB_SECTIONS,
  KB_SOURCE_ID_PREFIX,
  KB_SOURCE_REPO,
  SONGBEN_CLAUSE_FIRST,
  SONGBEN_CLAUSE_LAST,
  buildKbDataset,
  compareZh,
  type KbRawFile,
  type KbSkipped,
  type KbWarning,
} from '../lib/shanghan-kb.ts'

/**
 * 读取 data/vendor/shanghan-lun-knowledge-base（只读），写出 data/external/shanghan-kb/*.json。
 * 用法：npx tsx scripts/import/shanghan-kb.ts
 */

const LOG_TAG = '[import:shanghan-kb]'
const VENDOR_DIR_SEGMENTS = ['data', 'vendor', 'shanghan-lun-knowledge-base'] as const
const OUTPUT_DIR_SEGMENTS = ['data', 'external', 'shanghan-kb'] as const
const MARKDOWN_EXTENSION = '.md'
const WARNING_PREVIEW_LIMIT = 10
const GIT_TIMEOUT_MS = 10_000
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(fullPath)))
    else if (entry.isFile() && entry.name.endsWith(MARKDOWN_EXTENSION)) files.push(fullPath)
  }
  return files.sort()
}

function readVendorCommit(vendorDir: string): { commit: string | null; error?: string } {
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: vendorDir,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    if (!GIT_COMMIT_PATTERN.test(output)) return { commit: null, error: `git rev-parse 输出异常：${output}` }
    return { commit: output }
  } catch (error) {
    return { commit: null, error: error instanceof Error ? error.message.split('\n')[0] : String(error) }
  }
}

async function main(): Promise<void> {
  const root = projectRoot()
  const vendorDir = path.join(root, ...VENDOR_DIR_SEGMENTS)
  const contentDir = path.join(vendorDir, KB_CONTENT_DIR)
  const outputDir = path.join(root, ...OUTPUT_DIR_SEGMENTS)
  if (!(await fileExists(contentDir))) {
    throw new Error(`${LOG_TAG} 找不到 KB 内容目录：${contentDir}（请先克隆到 data/vendor/）`)
  }

  const extraWarnings: KbWarning[] = []
  const readFailures: KbSkipped[] = []
  const rawFiles: KbRawFile[] = []
  for (const section of KB_SECTION_KEYS) {
    const sectionDir = path.join(contentDir, ...KB_SECTIONS[section].dir.split('/'))
    if (!(await fileExists(sectionDir))) {
      extraWarnings.push({ path: KB_SECTIONS[section].dir, message: '目录不存在，本类卡片未导入' })
      continue
    }
    for (const filePath of await listMarkdownFiles(sectionDir)) {
      const locator = toPosix(path.relative(contentDir, filePath))
      try {
        rawFiles.push({ section, locator, text: await readText(filePath) })
      } catch (error) {
        readFailures.push({ path: locator, reason: `读取失败：${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }

  const dataset = buildKbDataset(rawFiles)

  const { commit, error: commitError } = readVendorCommit(vendorDir)
  if (commit === null) {
    extraWarnings.push({ path: '.', message: `无法获取 KB commit：${commitError ?? '未知错误'}` })
  } else if (commit !== KB_PINNED_COMMIT) {
    extraWarnings.push({ path: '.', message: `KB commit ${commit} 与核对版本 ${KB_PINNED_COMMIT} 不同，字段结构可能已变化` })
  }

  const warnings = [...extraWarnings, ...dataset.warnings]
  const skipped = [...dataset.skipped, ...readFailures].sort((a, b) => compareZh(a.path, b.path))
  const counts = {
    clauses: dataset.clauses.length,
    formulas: dataset.formulas.length,
    herbs: dataset.herbs.length,
    syndromes: dataset.syndromes.length,
    commentaries: dataset.commentaries.length,
    skipped: skipped.length,
    warnings: warnings.length,
  }

  await writeJson(path.join(outputDir, 'clauses.json'), dataset.clauses)
  await writeJson(path.join(outputDir, 'formulas.json'), dataset.formulas)
  await writeJson(path.join(outputDir, 'herbs.json'), dataset.herbs)
  await writeJson(path.join(outputDir, 'syndromes.json'), dataset.syndromes)
  await writeJson(path.join(outputDir, 'commentaries.json'), dataset.commentaries)
  await writeJson(path.join(outputDir, 'manifest.json'), {
    sourceRepo: KB_SOURCE_REPO,
    sourceId: commit ? `${KB_SOURCE_ID_PREFIX}@${commit}` : KB_SOURCE_ID_PREFIX,
    commit,
    pinnedCommit: KB_PINNED_COMMIT,
    license: KB_LICENSE,
    contentRoot: KB_CONTENT_DIR,
    generatedAt: new Date().toISOString(),
    counts,
    skipped,
    warnings,
  })

  console.log(`${LOG_TAG} 输出目录 ${outputDir}`)
  console.log(`${LOG_TAG} commit ${commit ?? '(未知)'}`)
  console.log(`${LOG_TAG} counts ${JSON.stringify(counts)}`)
  for (const item of skipped) console.log(`${LOG_TAG} skipped ${item.path}：${item.reason}`)
  for (const warning of warnings.slice(0, WARNING_PREVIEW_LIMIT)) {
    console.log(`${LOG_TAG} warning ${warning.path}：${warning.message}`)
  }
  if (warnings.length > WARNING_PREVIEW_LIMIT) {
    console.log(`${LOG_TAG} …其余 ${warnings.length - WARNING_PREVIEW_LIMIT} 条 warning 见 manifest.json`)
  }
  const collectionPaths = new Set<string>(['.', ...KB_SECTION_KEYS.map((section) => KB_SECTIONS[section].dir)])
  const collectionWarnings = warnings.filter((warning) => collectionPaths.has(warning.path))
  if (collectionWarnings.length > 0) {
    console.warn(`${LOG_TAG} ⚠ 关键假设未满足：`)
    for (const warning of collectionWarnings) console.warn(`${LOG_TAG}   ${warning.path}：${warning.message}`)
  } else {
    console.log(
      `${LOG_TAG} 条文号唯一且覆盖 ${SONGBEN_CLAUSE_FIRST}..${SONGBEN_CLAUSE_LAST}，名称无重复，commit 与核对版本一致`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

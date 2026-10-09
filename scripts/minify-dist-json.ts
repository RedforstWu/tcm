import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const distDataDir = path.resolve('dist/data')
const logThresholdBytes = 10 * 1024 * 1024

async function listJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(fullPath)))
      continue
    }
    if (entry.name.endsWith('.json')) files.push(fullPath)
  }
  return files
}

const files = await listJsonFiles(distDataDir)
for (const filePath of files) {
  const pretty = await readFile(filePath, 'utf8')
  const compact = JSON.stringify(JSON.parse(pretty))
  await writeFile(filePath, compact)
  if (pretty.length >= logThresholdBytes) {
    const relativePath = path.relative(path.resolve('dist'), filePath)
    const beforeMib = (pretty.length / 1024 / 1024).toFixed(1)
    const afterMib = (compact.length / 1024 / 1024).toFixed(1)
    console.log(`${relativePath} ${beforeMib} -> ${afterMib} MiB`)
  }
}

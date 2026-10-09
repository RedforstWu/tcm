import { mkdir, writeFile, readFile, access, rename, unlink, copyFile } from 'node:fs/promises'
import path from 'node:path'

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

async function writeFileAtomic(filePath: string, payload: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tmpPath, payload, 'utf8')
  try {
    await rename(tmpPath, filePath)
  } catch {
    // Windows：目标已存在时 rename 可能失败；先覆盖再删临时文件
    try {
      await copyFile(tmpPath, filePath)
    } catch {
      await writeFile(filePath, payload, 'utf8')
    }
    try {
      await unlink(tmpPath)
    } catch {
      /* ignore */
    }
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await writeFileAtomic(filePath, content)
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export function projectRoot(): string {
  return path.resolve(import.meta.dirname, '../..')
}

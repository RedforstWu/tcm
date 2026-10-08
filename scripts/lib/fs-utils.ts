import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, content, 'utf8')
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

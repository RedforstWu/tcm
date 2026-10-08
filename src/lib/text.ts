import { Converter } from 'opencc-js'

const toSimplified = Converter({ from: 'tw', to: 'cn' })
const toTraditional = Converter({ from: 'cn', to: 'tw' })

export type ScriptMode = 'simplified' | 'traditional'

export function convertScript(text: string, mode: ScriptMode): string {
  return mode === 'traditional' ? toTraditional(text) : toSimplified(text)
}

export function highlightTerms(text: string, terms: string[]): Array<{ text: string; hit: boolean }> {
  if (terms.length === 0) return [{ text, hit: false }]
  const sorted = [...terms].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(${sorted.map(escapeRegExp).join('|')})`, 'g')
  return text
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: sorted.includes(part) }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

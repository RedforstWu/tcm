import { loadBookRegistry } from './lib/books-registry.ts'
import { runAllParsers } from './lib/parser-dispatch.ts'

async function main(): Promise<void> {
  const registry = await loadBookRegistry()
  console.log(`[parse] books=${registry.length}`)
  const bundles = await runAllParsers(registry)
  for (const bundle of bundles) {
    if (bundle.stats) {
      console.log(`[parse] ${bundle.bookId}`, bundle.stats)
    } else {
      console.log(
        `[parse] ${bundle.bookId} clauses=${bundle.clauses.length} formulas=${bundle.formulas.length} monographs=${bundle.monographs.length}`,
      )
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

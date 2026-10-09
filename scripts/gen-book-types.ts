import path from 'node:path'
import { loadBookRegistry, renderBookTypesModule } from './lib/books-registry.ts'
import { projectRoot, writeText } from './lib/fs-utils.ts'

async function main(): Promise<void> {
  const root = projectRoot()
  const entries = await loadBookRegistry(root)
  const outPath = path.join(root, 'src', 'types', 'books.generated.ts')
  await writeText(outPath, renderBookTypesModule(entries))
  console.log(`[gen-book-types] wrote ${outPath} (${entries.length} books)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

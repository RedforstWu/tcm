import { spawn } from 'node:child_process'

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

async function main(): Promise<void> {
  await run('npx', ['tsx', 'scripts/fetch-sources.ts'])
  await run('npx', ['tsx', 'scripts/parse-all.ts'])
  await run('npx', ['tsx', 'scripts/build-dataset.ts'])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

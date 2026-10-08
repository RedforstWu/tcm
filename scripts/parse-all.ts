import { runGuilinParse } from './parse/guilin.ts'
import { runJinguiParse } from './parse/jingui.ts'
import { runSongbenParse } from './parse/songben.ts'
import { runBianzhengParse } from './parse/bianzheng.ts'
import { runFunvkeParse } from './parse/funvke.ts'
import { runFunankeParse } from './parse/funanke.ts'
import { runShishiParse } from './parse/shishi.ts'
import { runBencaoParse } from './parse/bencao.ts'

async function main(): Promise<void> {
  console.log('[parse] songben ...')
  const songben = await runSongbenParse()
  console.log(
    `[parse] songben clauses=${songben.validation.clauseCount} formulas=${songben.formulas.length} huxishu=${songben.validation.huxishuMatched}/${songben.validation.huxishuTotal}`,
  )
  if (songben.validation.mismatches.length > 0) {
    console.log('[parse] first mismatches:', songben.validation.mismatches.slice(0, 5))
  }

  console.log('[parse] jingui ...')
  const jingui = await runJinguiParse()
  console.log(
    `[parse] jingui chapters=${jingui.stats.chapterCount} clauses=${jingui.stats.clauseCount} formulas=${jingui.stats.formulaCount}`,
  )

  console.log('[parse] guilin ...')
  const guilin = await runGuilinParse()
  console.log(
    `[parse] guilin chapters=${guilin.stats.chapterCount} clauses=${guilin.stats.clauseCount} formulas=${guilin.stats.formulaCount}`,
  )

  console.log('[parse] funvke ...')
  const funvke = await runFunvkeParse()
  console.log(
    `[parse] funvke chapters=${funvke.stats.chapterCount} clauses=${funvke.stats.clauseCount} formulas=${funvke.stats.formulaCount}`,
  )

  console.log('[parse] funanke ...')
  const funanke = await runFunankeParse()
  console.log(
    `[parse] funanke chapters=${funanke.stats.chapterCount} clauses=${funanke.stats.clauseCount} formulas=${funanke.stats.formulaCount}`,
  )

  console.log('[parse] bianzheng ...')
  const bianzheng = await runBianzhengParse()
  console.log(
    `[parse] bianzheng chapters=${bianzheng.stats.chapterCount} clauses=${bianzheng.stats.clauseCount} formulas=${bianzheng.stats.formulaCount}`,
  )

  console.log('[parse] shishi ...')
  const shishi = await runShishiParse()
  console.log(
    `[parse] shishi chapters=${shishi.stats.chapterCount} clauses=${shishi.stats.clauseCount} formulas=${shishi.stats.formulaCount}`,
  )

  console.log('[parse] bencao ...')
  const bencao = await runBencaoParse()
  console.log(`[parse] bencao monographs=${bencao.stats.monographCount}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

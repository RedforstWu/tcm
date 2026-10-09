import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { faGraduationCap, faLink } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { Formula, FormulaDiffPair } from '@/types/data'
import { loadClauses, loadDiffPairs, loadFormulas } from '@/lib/data'

type QuizKind =
  | 'clause-to-formula'
  | 'composition-to-name'
  | 'mod-effect'
  | 'diff-symptom'
  | 'herb-to-formula'

interface Question {
  kind: QuizKind
  prompt: string
  answer: string
  options: string[]
  sourceHref?: string
  sourceLabel?: string
}

const WRONG_KEY = 'tcm-quiz-wrong'
const PROGRESS_KEY = 'tcm-quiz-progress'

interface QuizProgress {
  answered: number
  correct: number
  lastAt?: string
}

interface CurriculumUnit {
  id: string
  title: string
  description?: string
  formulaNames: string[]
  conceptIds?: string[]
}

interface CurriculumFile {
  units: CurriculumUnit[]
  prerequisites: Array<{ fromFormulaName: string; toFormulaName: string; reason?: string }>
}

function curriculumPool(curriculum: CurriculumFile | null): {
  formulaNames: Set<string>
  conceptIds: Set<string>
} {
  const formulaNames = new Set<string>()
  const conceptIds = new Set<string>()
  for (const unit of curriculum?.units ?? []) {
    for (const name of unit.formulaNames) formulaNames.add(name)
    for (const id of unit.conceptIds ?? []) conceptIds.add(id)
  }
  return { formulaNames, conceptIds }
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5)
}

function loadWrong(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WRONG_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function saveWrong(items: string[]) {
  localStorage.setItem(WRONG_KEY, JSON.stringify(items.slice(-50)))
}

function loadProgress(): QuizProgress {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{"answered":0,"correct":0}') as QuizProgress
  } catch {
    return { answered: 0, correct: 0 }
  }
}

function saveProgress(progress: QuizProgress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
}

function buildDiffQuestions(diffs: FormulaDiffPair[], formulas: Formula[]): Question[] {
  const byId = new Map(formulas.map((f) => [f.id, f]))
  const built: Question[] = []
  for (const diff of shuffle(diffs).slice(0, 15)) {
    const gained = diff.symptomDelta.gained
    const lost = diff.symptomDelta.lost
    if (gained.length === 0 && lost.length === 0) continue
    const fromName = byId.get(diff.fromId)?.name
    const toName = byId.get(diff.toId)?.name
    if (!fromName || !toName) continue
    const answer =
      [
        gained.length ? `多「${gained.slice(0, 3).join('、')}」` : '',
        lost.length ? `少「${lost.slice(0, 3).join('、')}」` : '',
      ]
        .filter(Boolean)
        .join('；') || '无明显症状差'
    const distractors = shuffle(diffs)
      .filter((item) => item.id !== diff.id)
      .slice(0, 3)
      .map((item) => {
        const g = item.symptomDelta.gained
        const l = item.symptomDelta.lost
        return (
          [
            g.length ? `多「${g.slice(0, 3).join('、')}」` : '',
            l.length ? `少「${l.slice(0, 3).join('、')}」` : '',
          ]
            .filter(Boolean)
            .join('；') || '无明显症状差'
        )
      })
      .filter((text) => text !== answer)
    if (distractors.length < 2) continue
    const change =
      diff.kind === 'add'
        ? `加${diff.herbName}`
        : diff.kind === 'remove'
          ? `去${diff.herbName}`
          : diff.kind === 'dose'
            ? `改${diff.herbName}剂量`
            : `多味加减`
    built.push({
      kind: 'diff-symptom',
      prompt: `从「${fromName}」到「${toName}」（${change}），症状差最可能是？`,
      answer,
      options: shuffle([answer, ...distractors.slice(0, 3)]),
      sourceHref: `/formulas/${encodeURIComponent(diff.toId)}`,
      sourceLabel: toName,
    })
  }
  return built
}

function buildHerbQuestions(formulas: Formula[]): Question[] {
  const withHerbs = formulas.filter((item) => item.book === 'songben' && item.herbs.length >= 3)
  const built: Question[] = []
  for (const formula of shuffle(withHerbs).slice(0, 15)) {
    const herb = shuffle(formula.herbs)[0]
    if (!herb) continue
    const answer = formula.name
    const options = shuffle([
      answer,
      ...shuffle(withHerbs)
        .filter((item) => item.id !== formula.id && item.herbs.some((h) => h.herbId === herb.herbId))
        .map((item) => item.name)
        .slice(0, 2),
      ...shuffle(withHerbs)
        .map((item) => item.name)
        .filter((name) => name !== answer)
        .slice(0, 3),
    ]).slice(0, 4)
    if (options.length < 4) continue
    built.push({
      kind: 'herb-to-formula',
      prompt: `含「${herb.name}」的经方是？`,
      answer,
      options: shuffle(options),
      sourceHref: `/formulas/${encodeURIComponent(formula.id)}`,
      sourceLabel: formula.name,
    })
  }
  return built
}

export function QuizPage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [wrong, setWrong] = useState<string[]>(loadWrong())
  const [progress, setProgress] = useState<QuizProgress>(loadProgress())
  const [curriculum, setCurriculum] = useState<CurriculumFile | null>(null)

  useEffect(() => {
    void (async () => {
      let curriculumData: CurriculumFile | null = null
      try {
        const response = await fetch('/data/curriculum.json')
        if (response.ok) curriculumData = (await response.json()) as CurriculumFile
      } catch {
        curriculumData = null
      }
      if (curriculumData) setCurriculum(curriculumData)

      const pool = curriculumPool(curriculumData)
      const [formulas, clauses, diffs] = await Promise.all([
        loadFormulas(),
        loadClauses('songben'),
        loadDiffPairs(),
      ])

      const inCurriculum = (formula: Formula) =>
        pool.formulaNames.size === 0 || pool.formulaNames.has(formula.name)

      const withHerbs = formulas.filter(
        (item) => item.book === 'songben' && item.herbs.length >= 3 && inCurriculum(item),
      )
      const distractorPool = formulas.filter(
        (item) => item.book === 'songben' && item.herbs.length >= 3,
      )
      const curriculumFormulaIds = new Set(withHerbs.map((item) => item.id))
      const withFormula = clauses.filter((clause) => {
        if (clause.formulaIds.length === 0) return false
        const hitsCurriculumFormula = clause.formulaIds.some((id) => curriculumFormulaIds.has(id))
        const hitsCurriculumConcept =
          pool.conceptIds.size > 0 &&
          (clause.conceptIds ?? []).some((id) => pool.conceptIds.has(id))
        return pool.formulaNames.size === 0
          ? true
          : hitsCurriculumFormula || hitsCurriculumConcept
      })

      const built: Question[] = []

      for (const clause of shuffle(withFormula).slice(0, 20)) {
        const answerId =
          clause.formulaIds.find((id) => curriculumFormulaIds.has(id)) ?? clause.formulaIds[0]!
        const answer = formulas.find((item) => item.id === answerId)?.name
        if (!answer) continue
        const options = shuffle([
          answer,
          ...shuffle(distractorPool)
            .map((item) => item.name)
            .filter((name) => name !== answer)
            .slice(0, 3),
        ])
        built.push({
          kind: 'clause-to-formula',
          prompt: `下列条文宜用何方？\n${clause.text.slice(0, 80)}`,
          answer,
          options,
          sourceHref: `/read/songben?clause=${encodeURIComponent(clause.id)}`,
          sourceLabel: clause.id,
        })
      }

      for (const formula of shuffle(withHerbs).slice(0, 20)) {
        const options = shuffle([
          formula.name,
          ...shuffle(distractorPool)
            .map((item) => item.name)
            .filter((name) => name !== formula.name)
            .slice(0, 3),
        ])
        built.push({
          kind: 'composition-to-name',
          prompt: `根据组成猜方名：\n${formula.herbs.map((herb) => herb.name).join('、')}`,
          answer: formula.name,
          options,
          sourceHref: `/formulas/${encodeURIComponent(formula.id)}`,
          sourceLabel: formula.name,
        })
      }

      for (const formula of withHerbs.filter((item) => item.modifications.length > 0).slice(0, 15)) {
        const mod = formula.modifications[0]!
        const answer = `若${mod.condition} → ${[
          mod.remove.length ? `去${mod.remove.join('、')}` : '',
          mod.add.length ? `加${mod.add.map((item) => item.name).join('、')}` : '',
        ]
          .filter(Boolean)
          .join('，')}`
        const distractors = distractorPool
          .filter((item) => item.id !== formula.id && item.modifications[0])
          .slice(0, 3)
          .map((item) => {
            const other = item.modifications[0]!
            return `若${other.condition} → ${[
              other.remove.length ? `去${other.remove.join('、')}` : '',
              other.add.length ? `加${other.add.map((row) => row.name).join('、')}` : '',
            ]
              .filter(Boolean)
              .join('，')}`
          })
        built.push({
          kind: 'mod-effect',
          prompt: `「${formula.name}」方后加减中，下列哪一项正确？`,
          answer,
          options: shuffle([answer, ...distractors]),
          sourceHref: `/formulas/${encodeURIComponent(formula.id)}`,
          sourceLabel: formula.name,
        })
      }

      const curriculumDiffs = diffs.filter((diff) => {
        const from = formulas.find((item) => item.id === diff.fromId)
        const to = formulas.find((item) => item.id === diff.toId)
        if (!from || !to) return false
        if (pool.formulaNames.size === 0) {
          return from.book === 'songben' || to.book === 'songben'
        }
        return inCurriculum(from) || inCurriculum(to)
      })
      built.push(...buildDiffQuestions(curriculumDiffs, formulas))
      built.push(...buildHerbQuestions(withHerbs.length > 0 ? withHerbs : distractorPool))

      setQuestions(shuffle(built))
    })()
  }, [])

  const current = questions[index]

  const stats = useMemo(
    () => ({ total: questions.length, wrong: wrong.length, progress }),
    [questions, wrong, progress],
  )

  function choose(option: string) {
    if (!current || selected) return
    setSelected(option)
    const correct = option === current.answer
    const nextProgress = {
      answered: progress.answered + 1,
      correct: progress.correct + (correct ? 1 : 0),
      lastAt: new Date().toISOString(),
    }
    setProgress(nextProgress)
    saveProgress(nextProgress)
    if (!correct) {
      const next = [...wrong, current.prompt.slice(0, 40)]
      setWrong(next)
      saveWrong(next)
    }
  }

  function nextQuestion() {
    setSelected(null)
    setIndex((value) => (value + 1) % Math.max(questions.length, 1))
  }

  if (!current) {
    return <p className="text-stone-500">题库加载中…</p>
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold">
            <FontAwesomeIcon icon={faGraduationCap} className="mr-2 text-cinnabar" />
            互动测验
          </h1>
          <p className="text-sm text-stone-500">
            第 {index + 1}/{stats.total} 题 · 错题本 {stats.wrong} 条 · 累计正确{' '}
            {stats.progress.correct}/{stats.progress.answered || 0}
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-teal underline"
          onClick={() => {
            setWrong([])
            saveWrong([])
            const cleared = { answered: 0, correct: 0 }
            setProgress(cleared)
            saveProgress(cleared)
          }}
        >
          清空错题与进度
        </button>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 sm:p-5">
        <p className="mb-2 text-xs uppercase tracking-wide text-stone-400">{current.kind}</p>
        <p className="whitespace-pre-wrap font-serif text-base leading-relaxed sm:text-lg">{current.prompt}</p>
        <div className="mt-4 space-y-2">
          {current.options.map((option) => {
            const isAnswer = option === current.answer
            const isChosen = option === selected
            let className = 'w-full rounded-xl border px-3 py-3 text-left text-sm sm:py-2 '
            if (!selected) className += 'border-stone-200 hover:bg-stone-50'
            else if (isAnswer) className += 'border-teal bg-teal-soft'
            else if (isChosen) className += 'border-cinnabar bg-cinnabar-soft'
            else className += 'border-stone-100 text-stone-400'
            return (
              <button key={option} type="button" className={className} onClick={() => choose(option)}>
                {option}
              </button>
            )
          })}
        </div>
        {selected && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={nextQuestion}
              className="rounded-xl bg-cinnabar px-4 py-3 text-sm text-white sm:py-2"
            >
              下一题
            </button>
            {current.sourceHref && (
              <Link to={current.sourceHref} className="text-sm text-teal hover:underline">
                <FontAwesomeIcon icon={faLink} className="mr-1" />
                出处：{current.sourceLabel}
              </Link>
            )}
          </div>
        )}
      </div>

      {curriculum && curriculum.units.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white/70 p-4 text-sm">
          <h2 className="mb-2 font-medium">学习单元（curriculum）</h2>
          <ul className="space-y-2 text-stone-600">
            {curriculum.units.map((unit) => (
              <li key={unit.id}>
                <p className="font-medium text-ink">{unit.title}</p>
                {unit.description && <p className="text-xs text-stone-500">{unit.description}</p>}
                <p className="text-xs text-stone-400">
                  方：{unit.formulaNames.join('、')}
                  {(curriculum.prerequisites ?? [])
                    .filter((item) => unit.formulaNames.includes(item.toFormulaName))
                    .map((item) => (
                      <span key={`${item.fromFormulaName}-${item.toFormulaName}`} className="ml-2">
                        先修 {item.fromFormulaName}
                      </span>
                    ))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {wrong.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white/70 p-4 text-sm">
          <h2 className="mb-2 font-medium">错题本（本地）</h2>
          <ul className="list-disc space-y-1 pl-5 text-stone-600">
            {wrong.slice(-8).map((item, wrongIndex) => (
              <li key={`${item}-${wrongIndex}`}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

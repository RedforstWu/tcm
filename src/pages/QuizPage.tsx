import { useEffect, useMemo, useState } from 'react'
import { loadClauses, loadFormulas } from '@/lib/data'

type QuizKind = 'clause-to-formula' | 'composition-to-name' | 'mod-effect'

interface Question {
  kind: QuizKind
  prompt: string
  answer: string
  options: string[]
}

const WRONG_KEY = 'tcm-quiz-wrong'

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

export function QuizPage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [wrong, setWrong] = useState<string[]>(loadWrong())

  useEffect(() => {
    void Promise.all([loadFormulas(), loadClauses('songben')]).then(([formulas, clauses]) => {
      const withHerbs = formulas.filter((item) => item.book === 'songben' && item.herbs.length >= 3)
      const withFormula = clauses.filter((clause) => clause.formulaIds.length > 0)
      const built: Question[] = []

      for (const clause of shuffle(withFormula).slice(0, 20)) {
        const answerId = clause.formulaIds[0]!
        const answer = formulas.find((item) => item.id === answerId)?.name
        if (!answer) continue
        const options = shuffle([
          answer,
          ...shuffle(withHerbs)
            .map((item) => item.name)
            .filter((name) => name !== answer)
            .slice(0, 3),
        ])
        built.push({
          kind: 'clause-to-formula',
          prompt: `下列条文宜用何方？\n${clause.text.slice(0, 80)}`,
          answer,
          options,
        })
      }

      for (const formula of shuffle(withHerbs).slice(0, 20)) {
        const options = shuffle([
          formula.name,
          ...shuffle(withHerbs)
            .map((item) => item.name)
            .filter((name) => name !== formula.name)
            .slice(0, 3),
        ])
        built.push({
          kind: 'composition-to-name',
          prompt: `根据组成猜方名：\n${formula.herbs.map((herb) => herb.name).join('、')}`,
          answer: formula.name,
          options,
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
        const distractors = withHerbs
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
        })
      }

      setQuestions(shuffle(built))
    })
  }, [])

  const current = questions[index]

  const stats = useMemo(() => ({ total: questions.length, wrong: wrong.length }), [questions, wrong])

  function choose(option: string) {
    if (!current || selected) return
    setSelected(option)
    if (option !== current.answer) {
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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold">互动测验</h1>
          <p className="text-sm text-stone-500">
            第 {index + 1}/{stats.total} 题 · 错题本 {stats.wrong} 条
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-teal underline"
          onClick={() => {
            setWrong([])
            saveWrong([])
          }}
        >
          清空错题
        </button>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white/90 p-5">
        <p className="mb-2 text-xs uppercase tracking-wide text-stone-400">{current.kind}</p>
        <p className="whitespace-pre-wrap font-serif text-lg leading-relaxed">{current.prompt}</p>
        <div className="mt-4 space-y-2">
          {current.options.map((option) => {
            const isAnswer = option === current.answer
            const isChosen = option === selected
            let className = 'w-full rounded-xl border px-3 py-2 text-left text-sm '
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
          <button
            type="button"
            onClick={nextQuestion}
            className="mt-4 rounded-xl bg-cinnabar px-4 py-2 text-sm text-white"
          >
            下一题
          </button>
        )}
      </div>

      {wrong.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white/70 p-4 text-sm">
          <h2 className="mb-2 font-medium">错题本（本地）</h2>
          <ul className="list-disc space-y-1 pl-5 text-stone-600">
            {wrong.slice(-8).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Clause, CrossLink, Formula, HerbRole } from '@/types/data'
import {
  bookTitle,
  loadAllClauses,
  loadCrossLinks,
  loadFormulas,
  loadHerbRoles,
} from '@/lib/data'
import { collationNoteForFormula } from '@/lib/formula-collation'
import { formatDualGrams } from '@/lib/dose-display'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import { DraftBanner } from '@/components/DraftBanner'
import { EvidenceDisclosure } from '@/components/integration/EvidenceDisclosure'

export function FormulaDetailPage() {
  const { formulaId = '' } = useParams()
  const id = decodeURIComponent(formulaId)
  const { scriptMode } = useAppContext()
  const [formula, setFormula] = useState<Formula | null>(null)
  const [allFormulas, setAllFormulas] = useState<Formula[]>([])
  const [related, setRelated] = useState<Formula[]>([])
  const [clauses, setClauses] = useState<Clause[]>([])
  const [roles, setRoles] = useState<HerbRole[]>([])
  const [crossLinks, setCrossLinks] = useState<CrossLink[]>([])

  useEffect(() => {
    void Promise.all([
      loadFormulas(),
      loadAllClauses(),
      loadHerbRoles(),
      loadCrossLinks(),
    ]).then(([formulas, allClauses, roleList, links]) => {
      const current = formulas.find((item) => item.id === id) ?? null
      setFormula(current)
      setAllFormulas(formulas)
      setRoles(roleList.filter((role) => role.formulaId === id))
      setCrossLinks(links.filter((link) => link.chenfuFormulaId === id))
      if (!current) return
      setRelated(
        formulas
          .filter(
            (item) =>
              item.id !== current.id &&
              (item.familyId === current.familyId ||
                item.alternateOf === current.id ||
                current.alternateOf === item.id ||
                item.name.includes(current.name.replace(/汤$/, '')) ||
                current.name.includes(item.name.replace(/汤$/, ''))),
          )
          .slice(0, 12),
      )
      setClauses(allClauses.filter((clause) => current.sourceClauseIds.includes(clause.id)))
    })
  }, [id])

  const herbIds = useMemo(() => new Set(formula?.herbs.map((herb) => herb.herbId) ?? []), [formula])
  const rolesByHerb = useMemo(() => {
    const map = new Map<string, HerbRole[]>()
    for (const role of roles) {
      const list = map.get(role.herbId) ?? []
      list.push(role)
      map.set(role.herbId, list)
    }
    return map
  }, [roles])

  const alternates = useMemo(() => {
    if (!formula) return []
    return allFormulas.filter(
      (item) =>
        item.alternateOf === formula.id ||
        (formula.alternateOf && item.id === formula.alternateOf) ||
        (formula.alternateOf && item.alternateOf === formula.alternateOf && item.id !== formula.id),
    )
  }, [allFormulas, formula])

  if (!formula) {
    return <p className="text-stone-500">未找到方剂。</p>
  }

  const collationNote = collationNoteForFormula(
    formula.id,
    formula.herbs.map((herb) => herb.name),
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      {formula.fangjie && <DraftBanner />}
      <div>
        <p className="text-sm text-stone-500">
          {bookTitle(formula.book)}
          {formula.role === 'alternate' && ' · 备选方'}
          {formula.doseSystem === 'qing' && ' · 清制剂量'}
        </p>
        <h1 className="font-serif text-2xl font-bold sm:text-3xl">{convertScript(formula.name, scriptMode)}</h1>
        {collationNote && (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-soft px-3 py-2 text-sm text-amber-950">
            {convertScript(collationNote, scriptMode)}
          </p>
        )}
        {formula.chapter && (
          <p className="mt-1 text-sm text-stone-500">{convertScript(formula.chapter, scriptMode)}</p>
        )}
        <EvidenceDisclosure
          className="mt-2"
          level={formula.evidenceLevel}
          evidence={formula.evidence}
          scriptMode={scriptMode}
        />
      </div>

      {alternates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-stone-500">同则主备方：</span>
          {alternates.map((item) => (
            <Link
              key={item.id}
              to={`/formulas/${encodeURIComponent(item.id)}`}
              className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-700 hover:bg-cinnabar-soft hover:text-cinnabar"
            >
              {convertScript(item.name, scriptMode)}
              <span className="ml-1 opacity-60">{item.role === 'main' ? '主' : '备'}</span>
            </Link>
          ))}
        </div>
      )}

      {crossLinks.length > 0 && (
        <section className="rounded-2xl border border-teal/30 bg-teal-soft/30 p-4 text-sm">
          <h2 className="mb-2 font-serif font-semibold text-teal">变方来源</h2>
          {crossLinks.map((link) => (
            <p key={link.id}>
              变方自：
              {link.jingfangFormulaId ? (
                <Link
                  className="text-cinnabar underline"
                  to={`/formulas/${encodeURIComponent(link.jingfangFormulaId)}`}
                >
                  {convertScript(link.derivedName, scriptMode)}
                </Link>
              ) : (
                <span>{convertScript(link.derivedName, scriptMode)}</span>
              )}
            </p>
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
        <h2 className="mb-3 font-serif text-lg font-semibold">组成</h2>
        {formula.herbs.length === 0 ? (
          <p className="text-sm text-stone-500">此版原文未载完整药味，或待从他本回填。</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {formula.herbs.map((herb) => {
              const herbRoles = rolesByHerb.get(herb.herbId) ?? []
              return (
                <div
                  key={`${herb.herbId}-${herb.doseRaw}`}
                  className="rounded-xl bg-paper-dark px-3 py-2 text-sm"
                >
                  <Link
                    to={`/herbs/${encodeURIComponent(herb.herbId)}`}
                    className="font-medium hover:text-cinnabar"
                  >
                    {convertScript(herb.name, scriptMode)}
                  </Link>
                  <span className="ml-2 text-stone-500">{herb.doseRaw}</span>
                  {herb.doseQian !== undefined && (
                    <span className="ml-2 text-xs text-stone-400">≈{herb.doseQian}钱</span>
                  )}
                  {herb.processing && (
                    <span className="ml-2 text-xs text-stone-400">({herb.processing})</span>
                  )}
                  {formatDualGrams(herb.doseLiang) && formula.doseSystem !== 'qing' && (
                    <div className="mt-1 text-xs text-stone-400">{formatDualGrams(herb.doseLiang)}</div>
                  )}
                  {herbRoles.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-teal">
                      {herbRoles.map((role) => (
                        <li key={role.id}>
                          <span className="font-medium">{role.roleText}</span>
                          {role.sourceSentence && (
                            <span className="text-stone-400"> — {role.sourceSentence}</span>
                          )}
                          <span className="ml-1 text-stone-300">[{role.method}]</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {formula.preparation && (
        <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
          <h2 className="mb-3 font-serif text-lg font-semibold">煎服法</h2>
          <p className="prose-classic text-sm leading-relaxed text-stone-700">
            {convertScript(formula.preparation, scriptMode)}
          </p>
        </section>
      )}

      {formula.fangjie && (
        <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
          <h2 className="mb-3 font-serif text-lg font-semibold">方解</h2>
          <p className="prose-classic text-sm leading-relaxed text-stone-700">
            {convertScript(formula.fangjie, scriptMode)}
          </p>
        </section>
      )}

      {formula.modifications.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
          <h2 className="mb-3 font-serif text-lg font-semibold">方后加减</h2>
          <ul className="space-y-2 text-sm">
            {formula.modifications.map((mod, index) => (
              <li key={index} className="rounded-xl bg-amber-soft/60 px-3 py-2">
                <span className="font-medium">若{mod.condition}</span>
                {mod.remove.length > 0 && <span>，去{mod.remove.join('、')}</span>}
                {mod.add.length > 0 && (
                  <span>，加{mod.add.map((item) => `${item.name}${item.doseRaw}`).join('、')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
        <h2 className="mb-3 font-serif text-lg font-semibold">出处条文</h2>
        <div className="space-y-3">
          {clauses.map((clause) => (
            <Link
              key={clause.id}
              to={`/read/${clause.book}?clause=${clause.id}`}
              className="block rounded-xl bg-paper-dark p-3 text-sm hover:bg-stone-100"
            >
              <div className="mb-1 text-xs text-stone-400">
                {bookTitle(clause.book)} · {clause.heading ?? clause.order}
              </div>
              {convertScript(clause.text.slice(0, 200), scriptMode)}
              {clause.text.length > 200 ? '…' : ''}
            </Link>
          ))}
          {clauses.length === 0 && <p className="text-sm text-stone-500">暂无直接挂钩条文。</p>}
        </div>
      </section>

      {related.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
          <h2 className="mb-3 font-serif text-lg font-semibold">相关方剂</h2>
          <div className="flex flex-wrap gap-2">
            {related.map((item) => {
              const shared = item.herbs.filter((herb) => herbIds.has(herb.herbId)).length
              return (
                <Link
                  key={item.id}
                  to={`/formulas/${encodeURIComponent(item.id)}`}
                  className="rounded-full bg-cinnabar-soft px-3 py-1 text-sm text-cinnabar"
                >
                  {convertScript(item.name, scriptMode)}
                  <span className="ml-1 text-xs opacity-70">共{shared}味</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

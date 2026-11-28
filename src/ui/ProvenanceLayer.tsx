import { useEffect, useRef, useState } from 'react'
import { AnchoredPopup } from './AnchoredPopup'
import { useProvenance, setProvenanceOn } from './provenancePref'
import { PROVENANCE_MAP } from '../client/provenanceMap'
import {
  highlightRuns,
  horizonHref,
  keyChain,
  pickKey,
  provenanceFor,
  type ProvLine,
  type ProvenanceMap,
} from '../client/provenanceMode'
import './provenance.css'

// Provenance mode (tc.154): while it is on, resting the pointer on a keyed
// piece of the interface (data-prov) for the dwell time opens a box listing
// the decisions and fixes that shaped it. client/provenanceMode.ts decides
// what the box says; this renders it.
//
// With the mode off, or on a host that does not offer it, nothing of it runs:
// no listener, no lookup, no DOM (spec sec 3.1). The mode records nothing
// about what anyone hovered (memory no-telemetry-anywhere).

export function ProvenanceLayer() {
  const prov = useProvenance()
  if (!prov.available || !prov.on) return null
  return <ProvenanceActive dwellMs={prov.dwellMs} sheenPreview={prov.sheenPreview} />
}

interface Open {
  chain: string[]
  depth: number
  // Bumped per opening, so the popup remounts against its new anchor.
  n: number
}

// A box closes when the pointer has been over neither its element nor the box
// for this long: long enough to cross the gap between them.
const GRACE_MS = 250

function keyedChain(start: Element | null): HTMLElement[] {
  const els: HTMLElement[] = []
  let at = start?.closest('[data-prov]') ?? null
  while (at) {
    els.push(at as HTMLElement)
    at = at.parentElement?.closest('[data-prov]') ?? null
  }
  // keyChain drops an invalid key; keep the elements in step with the keys.
  return els.filter((e) => keyChain([e.getAttribute('data-prov')]).length === 1)
}

function ProvenanceActive({ dwellMs, sheenPreview }: { dwellMs: number; sheenPreview: boolean }) {
  const [open, setOpen] = useState<Open | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const chainEls = useRef<HTMLElement[]>([])

  useEffect(() => {
    let dwell = 0
    let grace = 0
    let pending: HTMLElement | null = null
    let seq = 0
    // What is open, kept here as well as in state so a key press can work
    // from it without a side effect inside a state updater.
    let cur: Open | null = null
    const show = (next: Open | null) => {
      cur = next
      setOpen(next)
    }
    const close = () => {
      clearTimeout(grace)
      anchorRef.current = null
      chainEls.current = []
      show(null)
    }
    const onOver = (e: PointerEvent) => {
      // Dwell is a pointer's gesture; a touch has no resting place.
      if (e.pointerType === 'touch') return
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('.tc-prov-box')) {
        clearTimeout(grace)
        return
      }
      if (t?.closest('.tc-prov-badge')) return
      const anchor = anchorRef.current
      if (anchor) {
        clearTimeout(grace)
        if (!t || !anchor.contains(t)) grace = window.setTimeout(close, GRACE_MS)
      }
      const els = keyedChain(t)
      const inner = els[0] ?? null
      if (inner === pending) return
      pending = inner
      clearTimeout(dwell)
      if (!inner) return
      dwell = window.setTimeout(() => {
        if (anchorRef.current === inner) return
        clearTimeout(grace)
        chainEls.current = els
        anchorRef.current = inner
        show({ chain: keyChain(els.map((el) => el.getAttribute('data-prov'))), depth: 0, n: ++seq })
      }, dwellMs)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!anchorRef.current) return
      if (e.key === 'Escape') close()
      // Alt widens to the enclosing keyed piece, one level per press.
      if (e.key === 'Alt' && cur) {
        e.preventDefault()
        const next = pickKey(cur.chain, cur.depth + 1)
        if (!next || next.depth === cur.depth) return
        anchorRef.current = chainEls.current[next.depth] ?? anchorRef.current
        show({ ...cur, depth: next.depth, n: ++seq })
      }
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(dwell)
      clearTimeout(grace)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('keydown', onKey)
    }
  }, [dwellMs])

  // The sheen preview marks every keyed piece, to show the look before it is
  // decided which pieces belong to a goal (P5, P6).
  useEffect(() => {
    if (!sheenPreview) return
    const root = document.documentElement
    root.dataset.provSheen = 'preview'
    return () => {
      delete root.dataset.provSheen
    }
  }, [sheenPreview])

  const picked = open ? pickKey(open.chain, open.depth) : null
  return (
    <>
      <button
        type="button"
        className="tc-prov-badge"
        title="Provenance mode is on. Click to turn it off."
        onClick={() => setProvenanceOn(false)}
      >
        Provenance mode
      </button>
      {open && picked && (
        <AnchoredPopup
          key={open.n}
          anchorRef={anchorRef}
          onClose={() => {
            anchorRef.current = null
            setOpen(null)
          }}
          label={`Provenance of ${picked.key}`}
          className="tc-prov-box"
          takeFocus={false}
        >
          <ProvenanceBox provKey={picked.key} canWiden={picked.depth < open.chain.length - 1} />
        </AnchoredPopup>
      )}
    </>
  )
}

function Line({ line }: { line: ProvLine }) {
  const href = horizonHref(line.id)
  return (
    <li>
      {line.date && <span className="tc-prov-date">{line.date}</span>}
      {line.bug && <span className="tc-prov-bug">{line.bug}</span>}
      {href ? <a href={href} target="_blank" rel="noreferrer">{line.text}</a> : line.text}
    </li>
  )
}

// Exported for the visual harness, which hands it a fixture map; the app
// always reads the one map.
export function ProvenanceBox({ provKey, canWiden, map = PROVENANCE_MAP }: { provKey: string; canWiden: boolean; map?: ProvenanceMap }) {
  const answer = provenanceFor(map, provKey)
  return (
    <>
      <p className="tc-prov-key">{provKey}</p>
      {answer.kind === 'recorded' && (
        <>
          {answer.origin && (
            <>
              <p className="tc-prov-head">Asked for</p>
              <ul className="tc-prov-list"><Line line={answer.origin} /></ul>
            </>
          )}
          {answer.decisions.length > 0 && (
            <>
              <p className="tc-prov-head">Decided since</p>
              <ul className="tc-prov-list">{answer.decisions.map((l) => <Line key={l.id + (l.date ?? '')} line={l} />)}</ul>
            </>
          )}
          {answer.fixes.length > 0 && (
            <>
              <p className="tc-prov-head">Fixed</p>
              <ul className="tc-prov-list">{answer.fixes.map((l) => <Line key={l.id + (l.bug ?? '') + (l.date ?? '')} line={l} />)}</ul>
            </>
          )}
        </>
      )}
      {answer.kind === 'inferred' && (
        <>
          <p className="tc-prov-note">
            No decision was made for this element on its own; it follows from the piece it sits in
            ({answer.from}). This is an inference, not a record.
          </p>
          <p className="tc-prov-inferred">
            {highlightRuns(answer.description, answer.highlight).map((r, i) => (r.mark ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}
          </p>
        </>
      )}
      {answer.kind === 'none' && (
        <p className="tc-prov-note">
          {answer.mapEmpty
            ? 'Nothing is recorded for any element yet: the map from the roadmap to the interface has not been written.'
            : 'Nothing is recorded for this element.'}
        </p>
      )}
      {canWiden && <p className="tc-prov-hint">Alt: the piece around this one</p>}
    </>
  )
}

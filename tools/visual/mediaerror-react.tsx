// See mediaerror-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MediaErrorCard } from '../../src/ui/MediaErrorCard'
import { MEDIA_ERROR_STATUSES } from '../../src/client/mediaError'

const statuses: (number | null)[] = [...MEDIA_ERROR_STATUSES, null]
const boxes = [{ width: 400, height: 300 }, { width: 200, height: 150 }]
const root = createRoot(document.getElementById('root')!)
flushSync(() =>
  root.render(
    <>
      {boxes.flatMap((box) =>
        statuses.map((s) => (
          <span key={`${box.width}-${s}`} data-case={`${s ?? 'none'}@${box.width}`}>
            <MediaErrorCard status={s} box={box} onRetry={() => {}} />
          </span>
        )),
      )}
    </>,
  ),
)
const lines: string[] = []
let bad = 0
for (const el of document.querySelectorAll<HTMLElement>('[data-case]')) {
  const card = el.querySelector<HTMLElement>('.tc-media-error')!
  const r = card.getBoundingClientRect()
  const [, w] = el.dataset.case!.split('@')
  const want = Number(w)
  const sized = Math.round(r.width) === want && Math.round(r.height) === (want * 3) / 4
  let spill = false
  for (const k of card.querySelectorAll<HTMLElement>('*')) {
    const q = k.getBoundingClientRect()
    if (q.right > r.right + 0.5 || q.bottom > r.bottom + 0.5 || q.left < r.left - 0.5) spill = true
  }
  const compact = card.hasAttribute('data-compact')
  const ok = sized && !spill && compact === want < 320
  if (!ok) bad++
  lines.push(`${ok ? 'ok ' : 'BAD'} ${el.dataset.case} ${Math.round(r.width)}x${Math.round(r.height)} compact=${compact} spill=${spill} tone=${card.dataset.tone}`)
}
document.getElementById('result')!.textContent = `${bad === 0 ? 'ALL FIT' : bad + ' BAD'}\n` + lines.join('\n')

// See provenance-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ProvenanceBox, ProvenanceLayer } from '../../src/ui/ProvenanceLayer'
import { Ticker } from '../../src/ui/Ticker'
import { staticTickerSource } from '../../src/ui/tickerSource'
import { horizonFailureItems, horizonTickerItems } from '../../src/client/horizonFeed'
import type { ProvenanceMap } from '../../src/client/provenanceMode'

const row = (status: string) => ({ slug: 'x', title: 'x', summary: 'x', status, size: 'S', category: 'c', area: 'a' })
const status = {
  as_of: '2026-11-28T03:00:00Z',
  groups: [
    { key: 'm0', date: '2026-12-01', name: 'Launch', items: [row('done'), row('working'), row('open')], not_public: 2, not_public_done: 1 },
    { key: 'm1', date: '2026-12-15', name: 'Booru tags in chat', items: [row('done'), row('done')] },
    { key: 'p2', name: 'Not a milestone', items: [row('open')] },
  ],
}
const items = horizonTickerItems(status)
const failed = horizonFailureItems('the server answered 404', items, 5)

const map: ProvenanceMap = {
  ticker: {
    origin: { id: 'tc.155', date: '2026-11-27', text: 'A goal ticker reading horizon live' },
    decisions: [
      { id: 'tc.156', date: '2026-11-28', text: 'Shown to every signed-in member' },
      { id: 'tc.154', date: '2026-11-28', text: 'A failed read fails loudly' },
    ],
    fixes: [{ id: 'tc.157', date: '2026-11-28', text: 'Counts include rows that are not public', bug: 'bug-20261128-0000abcd' }],
    description: 'The strip above the chat box. It crawls the milestones. It never goes quiet on a failure.',
  },
  'ticker.item': { inheritsFrom: 'ticker', highlight: [[30, 55]] },
}

const root = createRoot(document.getElementById('root')!)
flushSync(() =>
  root.render(
    <>
      <div className="h-row">
        <div className="h-box" data-prov="room-list" id="outer">
          <p className="h-label">data-prov=room-list</p>
          <div className="h-box" data-prov="room-list.row" id="inner">data-prov=room-list.row (hover me)</div>
        </div>
        <div className="h-box" data-prov-goal="done" data-prov="goal-done">goal done (orange)</div>
        <div className="h-box" data-prov-goal="active" data-prov="goal-active">goal in progress (green)</div>
      </div>
      <div className="h-row">
        <div className="h-static">
          <p className="h-label">recorded (fixture map)</p>
          <div className="tc-prov-box"><ProvenanceBox provKey="ticker" canWiden={false} map={map} /></div>
        </div>
        <div className="h-static">
          <p className="h-label">inferred (fixture map)</p>
          <div className="tc-prov-box"><ProvenanceBox provKey="ticker.item" canWiden map={map} /></div>
        </div>
        <div className="h-static">
          <p className="h-label">the shipped map today</p>
          <div className="tc-prov-box"><ProvenanceBox provKey="composer" canWiden={false} /></div>
        </div>
      </div>
      <div style={{ width: 600 }} id="ticker-ok"><Ticker source={staticTickerSource(items)} collapsed={false} /></div>
      <div style={{ width: 600 }} id="ticker-failed"><Ticker source={staticTickerSource(failed)} collapsed={false} /></div>
      <ProvenanceLayer />
    </>,
  ),
)
const out: string[] = []
out.push(`ticker items: ${items.map((i) => i.text).join(' | ')}`)
out.push(`failure lead: ${failed[0].text}`)
out.push(`badge mounted: ${!!document.querySelector('.tc-prov-badge')}`)
document.getElementById('result')!.textContent = out.join('\n')

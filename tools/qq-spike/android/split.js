// Times one file read in steps (getFile, a 64 KB slice, a second slice, the whole file) on 30 PNGs
// of the picked folder. Run after a pick: node cdp.mjs @split.js 280
(async () => {
  const hs = []
  for await (const [, d] of folder.entries()) {           // txt2img-images
    if (d.kind !== 'directory') continue
    for await (const [, day] of d.entries()) {
      if (day.kind !== 'directory') continue
      for await (const [n, h] of day.entries()) { if (h.kind === 'file' && /\.png$/i.test(n)) hs.push(h); if (hs.length >= 30) break }
      break
    }
  }
  const t = { getFile: [], slice1: [], slice2: [], full: [] }
  const now = () => performance.now()
  for (const h of hs) {
    let a = now(); const f = await h.getFile(); t.getFile.push(now() - a)
    a = now(); await f.slice(0, 65536).arrayBuffer(); t.slice1.push(now() - a)
    a = now(); await f.slice(65536, 131072).arrayBuffer(); t.slice2.push(now() - a)
    a = now(); await f.arrayBuffer(); t.full.push(now() - a)
  }
  const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[s.length >> 1].toFixed(1) }
  const sum = (xs) => xs.reduce((x, y) => x + y, 0).toFixed(0)
  return JSON.stringify({ files: hs.length, median_ms: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, med(v)])), total_ms: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, sum(v)])) })
})()

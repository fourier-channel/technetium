// Runs the three measurements at 1, 4 and 8 reads at once and returns the log.
// The loop lives in the page, so it keeps going if the CDP client gives up: node cdp.mjs @runall.js 3600
(async () => {
  const $ = (id) => document.getElementById(id)
  for (const c of ['1', '4', '8']) {
    $('conc').value = c
    $('run').click()
    await new Promise(r => setTimeout(r, 500))
    while ($('run').disabled) await new Promise(r => setTimeout(r, 1000))
  }
  return $('out').value
})()

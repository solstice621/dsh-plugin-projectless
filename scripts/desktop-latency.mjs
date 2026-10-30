/** Measure one real Desktop selection without sending a model prompt. */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const root = new URL('../', import.meta.url)
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const desktopDataDirectory = process.env.DSH_DESKTOP_DATA_DIR
  ?? join(homedir(), 'Library', 'Application Support', '@deepseek-ai', 'dsh-desktop')
const version = JSON.parse(await readFile(join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-plugin-projectless', 'package.json'), 'utf8')).version
const port = (await readFile(join(desktopDataDirectory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
try {
  const page = browser.contexts()[0].pages().find(item => item.url().startsWith('dsh-app:'))
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  const order = await page.getByRole('menu').getByRole('menuitem').allTextContents()
  const rpc = []
  const starts = new Map()
  page.on('request', request => starts.set(request, performance.now()))
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/')) rpc.push({ path, ms: Math.round(performance.now() - (starts.get(response.request()) ?? performance.now())) })
  })
  await page.evaluate(() => {
    const measurement = globalThis.__projectlessMeasurement = { tasks: [] }
    const observer = new PerformanceObserver(list => {
      for (const item of list.getEntries()) measurement.tasks.push({ start: item.startTime, duration: item.duration })
    })
    observer.observe({ type: 'longtask' })
    const click = event => {
      if (event.target.closest('[role=menuitem]')?.textContent?.trim() !== '不在项目中工作') return
      document.removeEventListener('click', click, true)
      measurement.start = performance.now()
      const tick = () => {
        const elapsed = performance.now() - measurement.start
        if (!document.querySelector('[role=menu]') && measurement.menuClosed === undefined) measurement.menuClosed = elapsed
        if (document.querySelector('[data-projectless-workspace-chip]') && measurement.ready === undefined) measurement.ready = elapsed
        if (elapsed < 2500) requestAnimationFrame(tick)
        else observer.disconnect()
      }
      requestAnimationFrame(tick)
    }
    document.addEventListener('click', click, true)
  })
  await page.getByRole('menuitem', { name: '不在项目中工作', exact: true }).click()
  await page.waitForFunction(() => globalThis.__projectlessMeasurement.ready !== undefined)
  const metrics = await page.evaluate(() => globalThis.__projectlessMeasurement)
  const result = { version, order, metrics, rpc, modelRequestsSent: 0 }
  await writeFile(new URL('test-results/latency-' + version + '.json', root), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { await browser.close() }

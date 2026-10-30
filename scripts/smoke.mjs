/** Exercise the packed plugin in a disposable, real Harness Web profile. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = process.env.DSH_SMOKE_BIN
  ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const chrome = process.env.DSH_SMOKE_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
const targetHarnessVersion = pkg.devDependencies['@deepseek-ai/dsh-api-session-controller']
const artifactFilename = pkg.name + '-' + pkg.version + '.tgz'
const tarball = join(project, artifactFilename)
for (const path of [cli, chrome, tarball]) assert.ok(existsSync(path), 'Missing smoke prerequisite: ' + path)
const artifactSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')

const fixture = await realpath(await mkdtemp(join(tmpdir(), 'dsh-projectless-integration-')))
const home = join(fixture, 'home')
const documents = join(fixture, 'Documents')
const chats = join(fixture, 'Chats')
const results = join(project, 'test-results')
await mkdir(documents, { recursive: true })
await mkdir(results, { recursive: true })
for (const name of ['smoke.json', 'failure.txt', 'failure-ui.txt', 'failure.png']) {
  await rm(join(results, name), { force: true })
}

// Keep the actual OS home intact, and give the child only synthetic model credentials.
const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TZ']
  .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]))
Object.assign(env, {
  DSH_HOME: home,
  DSH_AGENTS_HOME: join(fixture, 'agents'),
  DSH_TELEMETRY_DISABLED: '1',
  DEEPSEEK_API_KEY: 'projectless-smoke-synthetic',
  NO_PROXY: 'localhost,127.0.0.1',
  // Exercise the portable browse backend without opening an OS dialog on the user's screen.
  SSH_CONNECTION: '127.0.0.1 50000 127.0.0.1 22',
})

let browser
let page
let harness
let logs = ''
let modelRequests = 0
let toolRequests = 0
const requestCwds = new Map()
const browserErrors = []
const browserConsoleErrors = []
const browserRequests = []
const browserRpcResponses = []
const browserStreamErrors = []
const blockedBrowserRequests = []
const modelPaths = []
const marker = 'projectless integration file\n'
const mock = createServer(async (request, response) => {
  modelPaths.push(request.url)
  if (request.method !== 'POST' || !['/anthropic/v1/messages', '/anthropic/messages'].includes(request.url)) {
    response.writeHead(404).end('Local fixture has no such route')
    return
  }
  try {
    let input = ''
    for await (const chunk of request) input += chunk
    const body = JSON.parse(input)
    modelRequests++
    const encoded = JSON.stringify(body)
    for (const cwd of requestCwds.keys()) if (encoded.includes(cwd)) requestCwds.set(cwd, true)
    const last = body.messages?.at(-1)
    const toolResult = Array.isArray(last?.content)
      ? last.content.find(item => item.type === 'tool_result') : undefined
    let content
    if (toolResult !== undefined) {
      content = [{ type: 'text', text: toolResult.is_error ? 'Projectless tool failed' : 'Projectless file saved' }]
    } else if (encoded.includes('projectless-smoke-write')) {
      assert.ok(body.tools?.some(tool => tool.name === 'write'), 'The ordinary write tool must be available')
      toolRequests++
      content = [{ type: 'tool_use', id: 'toolu_projectless_smoke', name: 'write',
        input: { file_path: 'outputs/smoke.txt', content: marker } }]
    } else {
      content = [{ type: 'text', text: encoded.includes('projectless-smoke-two')
        ? 'Projectless reply two' : 'Projectless reply one' }]
    }
    const message = {
      id: 'msg_projectless_' + modelRequests, type: 'message', role: 'assistant', model: body.model,
      content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 12 },
    }
    if (!body.stream) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const event = (type, data) => response.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n')
    event('message_start', { message: { ...message, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 } } })
    for (const [index, block] of content.entries()) {
      event('content_block_start', { index, content_block: block.type === 'text'
        ? { type: 'text', text: '' } : { type: 'tool_use', id: block.id, name: block.name, input: {} } })
      event('content_block_delta', { index, delta: block.type === 'text'
        ? { type: 'text_delta', text: block.text }
        : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
      event('content_block_stop', { index })
    }
    event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 12 } })
    event('message_stop', {})
    response.end()
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' })
      .end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: String(error) } }))
  }
})

function sanitize(value) {
  return String(value).replace(/([?&]token=)[^\s&#"']+/g, '$1[redacted]')
    .replaceAll(fixture, '<fixture>')
}

async function runCli(args) {
  const child = spawn(cli, args, { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const timer = setTimeout(() => child.kill('SIGTERM'), 120_000)
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  }).finally(() => clearTimeout(timer))
  assert.equal(code, 0, sanitize(output))
  return output
}

async function startHarness(overlay) {
  const child = spawn(cli, ['--profile', 'projectless-smoke', '--patch', overlay,
    '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const ready = Promise.withResolvers()
  const capture = chunk => {
    output += chunk
    logs += chunk
    const match = output.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\S*)/)
    if (match) ready.resolve(match[1])
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.once('error', ready.reject)
  child.once('exit', code => ready.reject(new Error('Harness exited ' + code + ': ' + sanitize(output))))
  harness = child
  const timeout = setTimeout(() => ready.reject(new Error('Harness startup timed out: ' + sanitize(output))), 45_000)
  const url = await ready.promise.finally(() => clearTimeout(timeout))
  return url
}

async function stopHarness() {
  const child = harness
  harness = undefined
  if (child === undefined || child.exitCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 10_000)
  await exited.finally(() => clearTimeout(force))
}

async function newPage(url, firstUse = false) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 960 } })
  await context.route('**/*', route => {
    const target = new URL(route.request().url())
    if (target.hostname === '127.0.0.1' || target.protocol === 'data:' || target.protocol === 'blob:') return route.continue()
    blockedBrowserRequests.push(target.origin + target.pathname)
    return route.abort()
  })
  const next = await context.newPage()
  next.on('pageerror', error => { browserErrors.push(sanitize(error.stack ?? error.message)) })
  next.on('console', message => { if (message.type() === 'error') browserConsoleErrors.push(sanitize(message.text())) })
  next.on('request', request => { browserRequests.push(new URL(request.url()).pathname) })
  next.on('response', async response => {
    const path = new URL(response.url()).pathname
    if (!['/api/session/create', '/api/session/list', '/api/projectless-chat/create'].includes(path)) return
    const value = await response.json().catch(() => undefined)
    browserRpcResponses.push({ path, status: response.status(), value })
  })
  next.on('websocket', socket => socket.on('framereceived', frame => {
    try {
      const value = JSON.parse(String(frame.payload))
      if (value.error !== undefined || value.result?.ok === false || String(value.type).includes('error')) browserStreamErrors.push(value)
    } catch {}
  }))
  await next.goto(url, { waitUntil: 'domcontentloaded' })
  page = next
  await next.getByRole('button', { name: '选择工作区', exact: true }).waitFor({ timeout: 30_000 })
  // Fresh browser contexts must acknowledge Harness's own first-use preview notice.
  if (firstUse) await next.getByRole('button', { name: '继续', exact: true }).click({ timeout: 20_000 })
  assert.equal(await next.getByRole('button', { name: '自由聊天', exact: true }).count(), 0)
  return context
}

async function noWorkspace(retry = false) {
  const registryBefore = await readFile(join(home, 'storages', 'workspace.json'), 'utf8')
  const refreshesBefore = browserRequests.filter(path => path === '/api/session/list').length
  if (!retry) await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/projectless-chat/create', { timeout: 20_000 }),
    (retry ? page.getByRole('button', { name: '重试', exact: true }) : page.getByRole('menuitem', { name: '不在项目中工作', exact: true })).click({ timeout: 20_000 }),
  ])
  assert.equal(response.status(), 200)
  const envelope = await response.json()
  assert.equal(envelope.result.ok, true, JSON.stringify(envelope.result))
  const chat = envelope.result.value
  assert.ok(chat.cwd.startsWith(chats + '/'))
  assert.ok(existsSync(chat.workDirectory) && existsSync(chat.outputDirectory))
  await page.locator('[data-conversation-session="' + chat.sessionId + '"] [data-composer-input][contenteditable="true"]').waitFor({ timeout: 20_000 })
  assert.equal(await page.getByRole('dialog').count(), 0, 'No workspace must open without a folder picker')
  assert.equal(await page.locator('[data-projectless-workspace-chip]').innerText(), '不在项目中工作')
  assert.equal(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'), registryBefore, 'Choosing No workspace must leave the complete Workspace registry unchanged')
  assert.equal(browserRequests.filter(path => path === '/api/session/list').length, refreshesBefore, 'Normal selection must use the live announcement instead of reloading all session history')
  return { chat, request: response.request().postDataJSON() }
}

async function prompt(sessionId, text, reply) {
  const conversation = page.locator('[data-conversation-session="' + sessionId + '"]')
  const editor = conversation.locator('[data-composer-input][contenteditable="true"]')
  await editor.fill(text)
  await editor.press('Enter')
  await conversation.getByText(reply, { exact: true }).waitFor({ timeout: 30_000 })
}

async function sessionLogs(directory = join(home, 'sessions')) {
  const entries = await readdir(directory, { withFileTypes: true })
  const parts = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sessionLogs(join(directory, entry.name))
    : entry.name.endsWith('.jsonl') ? readFile(join(directory, entry.name), 'utf8')
    : entry.name.endsWith('.jsonl.zstd')
      ? readFile(join(directory, entry.name)).then(bytes => zstdDecompressSync(bytes).toString('utf8')) : ''))
  return parts.join('\n')
}

try {
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const baseURL = 'http://127.0.0.1:' + mock.address().port + '/anthropic'
  const overlay = join(fixture, 'smoke.patch.yml')
  await writeFile(overlay, [
    '- id: workspace-controller', '  config:', '    documentsDirectory: ' + JSON.stringify(documents),
    '- id: projectless-chat', '  config:', '    workspaceRoot: ' + JSON.stringify(chats),
    '- id: locale', '  config:', '    preference: zh',
    '- id: llm-deepseek', '  config:', '    baseURL: ' + JSON.stringify(baseURL),
    '    thinking: disabled', '    reasoningEffort: off', '    maxTokens: 512',
    '    models:', '      - id: deepseek-flash', '        name: Local integration fixture', '        contextWindow: 1048576',
    '- id: llm-pi-ai', '  disabled: true', '- id: llm-deepseek-account', '  disabled: true',
    '- id: session-title-llm', '  disabled: true',
  ].join('\n') + '\n')
  console.log('Preparing a disposable Harness Web profile and installing the tarball…')
  const harnessVersion = (await runCli(['--version'])).trim()
  assert.equal(harnessVersion, targetHarnessVersion, 'This smoke fixture targets the plugin development API version')
  await runCli(['--profile', 'projectless-smoke', '--from-default-profile', 'web', '--dump-config'])
  // Local tarball identities are cached by pnpm; use a fresh spec after rebuilding the same version.
  const snapshot = join(fixture, 'packed-plugin.tgz')
  await copyFile(tarball, snapshot)
  await runCli(['plugin', '--profile', 'projectless-smoke', 'add', snapshot])
  for (const entry of ['host.js', 'client.js']) {
    assert.equal(await readFile(join(home, 'profiles', 'projectless-smoke', 'node_modules', 'dsh-plugin-projectless', 'lib', entry), 'utf8'),
      await readFile(join(project, 'lib', entry), 'utf8'), 'The installed plugin must match the freshly built ' + entry)
  }
  const url = await startHarness(overlay)
  browser = await chromium.launch({ executablePath: chrome, headless: true })
  const context = await newPage(url, true)
  const workspaceFile = join(home, 'storages', 'workspace.json')
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 20_000 })
  const workspaceBefore = await readFile(workspaceFile, 'utf8')
  await page.screenshot({ path: join(results, 'startup.png'), fullPage: true })
  console.log('Checking the original Workspace menu, draft transfer, re-selection, and switching back…')
  const draft = 'unsent projectless draft'
  await page.locator('[data-composer-input][contenteditable="true"]').fill(draft)
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  const menu = page.getByRole('menu')
  await menu.getByRole('menuitem', { name: '不在项目中工作', exact: true }).waitFor()
  const projectItem = menu.getByRole('menuitem').filter({ hasNotText: /不在项目中工作|添加工作区/ }).first()
  const projectName = await projectItem.innerText()
  assert.ok(projectName.length > 0, 'The original Workspace must still be listed')
  await menu.getByRole('menuitem', { name: '添加工作区…', exact: true }).waitFor()
  assert.deepEqual((await menu.getByRole('menuitem').allTextContents()).slice(-2), ['添加工作区…', '不在项目中工作'])
  await page.screenshot({ path: join(results, 'workspace-menu.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.route('**/api/projectless-chat/create', async route => {
    const { rpcId } = route.request().postDataJSON()
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'server-response', rpcId,
      result: { ok: false, error: { code: 'projectless/busy', message: 'Synthetic creation failure; retry is safe' } } }) })
  }, { times: 1 })
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  await page.getByRole('menuitem', { name: '不在项目中工作', exact: true }).click()
  await page.getByRole('dialog', { name: '无法完成工作区选择' }).waitFor()
  assert.equal(await page.getByRole('menu').count(), 0, 'An asynchronous creation failure remains recoverable after the menu closes')
  // Even when creation is delayed, the selection closes immediately and keeps its retry owner alive.
  const createGate = Promise.withResolvers()
  const createEntered = Promise.withResolvers()
  const holdCreation = async route => { createEntered.resolve(); await createGate.promise; await route.continue() }
  await page.route('**/api/projectless-chat/create', holdCreation)
  const openingScratch = noWorkspace(true)
  await createEntered.promise
  await page.getByRole('menu').waitFor({ state: 'hidden', timeout: 1000 })
  assert.equal(await page.locator('[data-projectless-workspace-chip]').count(), 0, 'Closing the menu must not pretend the pending creation succeeded')
  createGate.resolve()
  const scratch = await openingScratch
  await page.unroute('**/api/projectless-chat/create', holdCreation)
  const scratchEditor = page.locator('[data-conversation-session="' + scratch.chat.sessionId + '"] [data-composer-input][contenteditable="true"]')
  assert.equal(await scratchEditor.innerText(), draft, 'The text draft must arrive in the new no-workspace Session')
  await page.screenshot({ path: join(results, 'no-workspace-blank.png'), fullPage: true })
  const requestCount = browserRequests.filter(path => path === '/api/projectless-chat/create').length
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  await page.getByRole('menuitem', { name: '不在项目中工作', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  assert.equal(browserRequests.filter(path => path === '/api/projectless-chat/create').length, requestCount, 'Re-selecting No workspace must not allocate another Session')
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  await page.getByRole('menuitem', { name: projectName, exact: true }).click()
  await page.locator('[data-projectless-conversation]').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('[data-composer-input][contenteditable="true"]').innerText(), draft, 'Native Workspace switching must preserve the text draft')
  console.log('Checking distinct directories, RPC replay, and ordinary chat…')
  const first = await noWorkspace()
  requestCwds.set(first.chat.cwd, false)
  await prompt(first.chat.sessionId, 'projectless-smoke-one', 'Projectless reply one')
  const replay = await page.evaluate(async original => {
    const response = await fetch('/api/projectless-chat/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...original, rpcId: crypto.randomUUID() }) })
    return response.json()
  }, first.request)
  assert.equal(replay.result.value.sessionId, first.chat.sessionId)
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
  const second = await noWorkspace()
  requestCwds.set(second.chat.cwd, false)
  assert.notEqual(first.chat.cwd, second.chat.cwd)
  assert.notEqual(first.chat.sessionId, second.chat.sessionId)
  await prompt(second.chat.sessionId, 'projectless-smoke-two', 'Projectless reply two')
  // The ordinary New Session button may update Workspace membership; ungrouped chats never do.
  const workspaceAfter = await readFile(workspaceFile, 'utf8')
  for (const item of [scratch, first, second]) assert.ok(!workspaceAfter.includes(item.chat.sessionId), 'No-workspace Sessions must remain ungrouped')
  assert.deepEqual(Object.keys(JSON.parse(workspaceAfter)), Object.keys(JSON.parse(workspaceBefore)))
  const saved = await sessionLogs()
  for (const item of [first, second]) {
    assert.ok(saved.includes(item.chat.cwd), 'Harness must persist the allocated cwd')
    assert.ok(saved.includes(item.chat.sessionId), 'Harness must persist the Session identity')
  }
  await page.screenshot({ path: join(results, 'no-workspace-chat.png'), fullPage: true })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('projectless-smoke-two', { exact: true }).first().click()
  await page.getByText('Projectless reply two', { exact: true }).waitFor({ timeout: 20_000 })
  await context.close()
  await stopHarness()
  console.log('Restarting Harness and checking cold restoration plus a relative file write…')
  const restarted = await startHarness(overlay)
  const restoredContext = await newPage(restarted)
  // A fresh browser starts with the ungrouped history section collapsed.
  await page.getByText('未分组', { exact: true }).click()
  await page.getByText('projectless-smoke-two', { exact: true }).first().click()
  await page.getByText('Projectless reply two', { exact: true }).waitFor({ timeout: 20_000 })
  await prompt(second.chat.sessionId, 'projectless-smoke-write', 'Projectless file saved')
  assert.equal(await readFile(join(second.chat.cwd, 'outputs', 'smoke.txt'), 'utf8'), marker)
  assert.equal(existsSync(join(first.chat.cwd, 'outputs', 'smoke.txt')), false)
  assert.equal(existsSync(join(fixture, 'outputs', 'smoke.txt')), false)
  assert.equal(await readFile(workspaceFile, 'utf8'), workspaceAfter)
  assert.equal(toolRequests, 1)
  assert.deepEqual(Array.from(requestCwds.values()), [true, true], 'The model context must contain each allocated cwd')
  assert.deepEqual(browserErrors, [])
  await page.screenshot({ path: join(results, 'restored-chat.png'), fullPage: true })
  console.log('Checking that Add workspace still opens, cancels, and adopts a directory…')
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加工作区…', exact: true }).click()
  const directoryDialog = page.getByRole('dialog', { name: '选择工作区目录' })
  await directoryDialog.waitFor()
  await directoryDialog.getByRole('button', { name: '取消', exact: true }).last().click()
  await directoryDialog.waitFor({ state: 'hidden' })
  const extraProject = join(fixture, 'extra-project')
  await mkdir(extraProject)
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加工作区…', exact: true }).click()
  await directoryDialog.getByRole('textbox', { name: '目录路径', exact: true }).fill(extraProject)
  await directoryDialog.getByRole('button', { name: '前往', exact: true }).click()
  await directoryDialog.locator('[data-projectless-directory-path="' + extraProject + '"]').waitFor()
  await directoryDialog.getByRole('button', { name: '选择此目录', exact: true }).click()
  await directoryDialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '选择工作区', exact: true }).filter({ hasText: 'extra-project' }).waitFor()
  assert.ok((await readFile(workspaceFile, 'utf8')).includes(extraProject), 'Add workspace must still register the chosen project')
  assert.deepEqual(browserErrors, [])
  await restoredContext.close()
  await writeFile(join(results, 'smoke.json'), JSON.stringify({
    harnessVersion, plugin: pkg.name + '@' + pkg.version, passed: true,
    artifact: { filename: artifactFilename, sha256: artifactSha256 },
    checks: ['tarball installation', 'No workspace in original Workspace menu', 'no Free chat sidebar',
      'No workspace below Add workspace', 'menu dismisses while creation is pending', 'closed-menu creation failure and retry', 'no full history refresh on normal selection',
      'text draft transfer and native Workspace switching', 'keyboard re-selection without allocation',
      'Add workspace browser dialog cancel and directory adoption', 'no folder picker for No workspace', 'distinct persistent cwd',
      'authenticated RPC replay', 'ordinary prompt and streaming response', 'unchanged Workspace registry',
      'saved Session cwd', 'browser reload', 'Host restart and cold Session restoration', 'relative file write in restored cwd',
      'allocated cwd in model context'],
    chats: [first.chat, second.chat].map(chat => ({ ...chat, cwd: sanitize(chat.cwd),
      workDirectory: sanitize(chat.workDirectory), outputDirectory: sanitize(chat.outputDirectory) })),
    modelRequests, toolRequests, browserErrors, blockedBrowserRequests,
    model: 'local synthetic Messages/SSE fixture; no live model request',
  }, null, 2) + '\n')
  console.log('Harness integration smoke passed. Sanitized evidence: test-results/smoke.json')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(results, 'failure.png'), fullPage: true }).catch(() => {})
  if (page && !page.isClosed()) await writeFile(join(results, 'failure-ui.txt'), sanitize(await page.locator('body').innerText())).catch(() => {})
  await writeFile(join(results, 'failure.txt'), sanitize(error.stack ?? error) + '\n')
  process.exitCode = 1
  console.error(sanitize(error.stack ?? error))
} finally {
  await browser?.close().catch(() => {})
  await stopHarness()
  await new Promise(resolve => mock.close(resolve))
  await writeFile(join(results, 'harness.log'), sanitize(logs))
  await writeFile(join(results, 'browser-debug.json'), sanitize(JSON.stringify({ browserErrors, browserConsoleErrors, browserRequests,
    browserRpcResponses, browserStreamErrors, modelPaths, modelRequests, toolRequests }, null, 2)))
  await rm(fixture, { recursive: true, force: true })
}

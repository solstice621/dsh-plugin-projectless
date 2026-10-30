/** Directory allocation uses only disposable test roots. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { access, lstat, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatDirectory } from '../src/directories.ts'

const fixtures: string[] = []
afterEach(async () => {
  for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true })
})
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-projectless-directories-'))
  fixtures.push(root)
  return root
}

test('concurrent chats own distinct persistent directories and leave the process cwd untouched', async () => {
  const fixtureRoot = await fixture()
  const root = join(fixtureRoot, 'Chats')
  const cwdBefore = process.cwd()
  const now = new Date(2026, 9, 29, 12)
  const chats = await Promise.all(Array.from({ length: 16 }, () => createChatDirectory(root, now)))
  assert.equal(new Set(chats.map(chat => chat.cwd)).size, 16)
  assert.equal(process.cwd(), cwdBefore)
  for (const chat of chats) {
    assert.ok(chat.cwd.startsWith(join(await realpath(root), '2026-10-29', 'chat-')))
    assert.deepEqual((await readdir(chat.cwd)).sort(), ['outputs', 'work'])
    assert.equal((await lstat(chat.workDirectory)).isDirectory(), true)
    assert.equal((await lstat(chat.outputDirectory)).isDirectory(), true)
  }
})

test('configured root aliases resolve to the canonical directory saved in Session metadata', async () => {
  const root = await fixture()
  const target = join(root, 'actual')
  await mkdir(target)
  const alias = join(root, 'alias')
  await symlink(target, alias)
  const chat = await createChatDirectory(alias)
  assert.ok(chat.cwd.startsWith(await realpath(target) + '/'))
  assert.equal(await realpath(chat.cwd), chat.cwd)
})

test('a redirected date directory is refused before writing chat files outside the configured root', async () => {
  const root = await fixture()
  const destination = join(root, 'other')
  const chats = join(root, 'Chats')
  await mkdir(destination)
  await mkdir(chats)
  await symlink(destination, join(chats, '2026-10-29'))
  await assert.rejects(createChatDirectory(chats, new Date(2026, 9, 29, 12)), /real directory/)
  assert.deepEqual(await readdir(destination), [])
})

test('an invalid root does not fall back to the invoking directory', async () => {
  await assert.rejects(createChatDirectory('relative/chats'), /absolute path/)
  const root = await fixture()
  const blocked = join(root, 'file')
  await writeFile(blocked, 'existing content')
  await assert.rejects(createChatDirectory(blocked))
  await access(blocked)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { directoryChoice } from '../src/directory-choice.ts'

const unexpected = async (): Promise<never> => { throw new Error('Unexpected directory operation') }

test('Desktop selection and cancellation use the native bridge without host browsing', async () => {
  for (const answer of ['/chosen/project', null]) {
    assert.equal(await directoryChoice({ desktop: { pick: async () => answer },
      probeBrowse: unexpected, pickNative: unexpected }), answer)
  }
})

test('a native-only local Web host opens its OS chooser and preserves cancellation', async () => {
  for (const answer of ['/chosen/project', null]) {
    const probeBrowse = async () => { throw Object.assign(new Error('native capability'), {
      rpcError: { code: 'directory-picker/unavailable', details: { capability: 'native' } },
    }) }
    assert.equal(await directoryChoice({ probeBrowse, pickNative: async () => answer }), answer)
  }
})

test('browse hosts and unreadable starting folders open the in-page browser', async () => {
  for (const probeBrowse of [async () => ({}), async () => {
    throw { rpcError: { code: 'directory-picker/unreadable' } }
  }]) {
    assert.equal(await directoryChoice({ probeBrowse, pickNative: unexpected }), undefined)
  }
})

test('permission and transport failures are surfaced without opening another picker', async () => {
  for (const error of [new Error('offline'), { rpcError: { code: 'gateway/forbidden' } },
    { rpcError: { code: 'directory-picker/unavailable', details: { capability: 'browse' } } }]) {
    await assert.rejects(directoryChoice({ probeBrowse: async () => { throw error }, pickNative: unexpected }),
      actual => actual === error)
  }
})

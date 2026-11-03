import assert from 'node:assert/strict'
import test from 'node:test'
import { runBrowserScript } from '../src/host/browser/sandbox.js'

test('a browser script can await the helpers and finish with done()', async () => {
  const seen = []
  const text = await runBrowserScript(
    `const page = await goto('https://example.com/a'); await click('e1'); done(page + ' ok')`,
    {
      goto: async (url) => { seen.push(url); return 'snap' },
      click: async (ref) => { seen.push(ref); return 'clicked' },
    },
  )
  assert.equal(text, 'snap ok')
  assert.deepEqual(seen, ['https://example.com/a', 'e1'])
})

test('a browser script that returns without done() uses the return value', async () => {
  assert.equal(await runBrowserScript(`return 'from return'`, {}), 'from return')
  assert.equal(await runBrowserScript(`return`, {}), 'Script finished without done().')
})

test('a browser script cannot reach the host process', async () => {
  const quiet = await runBrowserScript('done(String(globalThis.process))', {})
  assert.equal(quiet, 'undefined')
  const escapes = [
    'return process.env',
    'return require("fs")',
    'return import("node:fs")',
    'return goto.constructor.constructor("return process")()',
    'return Function("return process")()',
    'return eval("process")',
  ]
  for (const body of escapes) {
    await assert.rejects(
      runBrowserScript(body, { goto: async () => 'no' }),
      (error) => {
        assert.equal(/EACCES|ENOENT|secrets\.json/.test(String(error)), false, body)
        return true
      },
      body,
    )
  }
  // Closing the wrapper early still runs inside the sandbox, so `process` is not the host one.
  const closed = await runBrowserScript('})(); done(String(process)); await (async () => {', { goto: async () => 'no' })
  assert.equal(closed, 'Script finished without done().')
})

test('a browser script that does not finish is stopped', async () => {
  await assert.rejects(
    runBrowserScript('await goto("https://example.com")', {
      goto: () => new Promise(() => {}),
    }, { timeoutMs: 30 }),
    /Script ran longer than 0\.03 seconds/,
  )
})

test('a browser script longer than 8000 characters is refused before it runs', async () => {
  await assert.rejects(runBrowserScript('x'.repeat(8001), {}), /8000/)
})

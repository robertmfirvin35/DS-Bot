// browser_exec runs a model-written function body. It used to be an AsyncFunction
// in the host realm, so the script could reach this process (process, require, the
// secrets file) through the global object or a helper's constructor. The body now
// runs in a vm context that cannot compile new code from strings. Helpers are
// functions of that context; the host function they close over is not a parameter
// of the script.
import vm from 'node:vm'

const PARAMS = ['goto', 'snapshot', 'click', 'type', 'fill', 'select', 'press', 'scroll', 'tabs', 'screenshot', 'text', 'upload', 'handoff', 'resume', 'back', 'done']
const TIMEOUT_MS = 20_000

export async function runBrowserScript(source, calls, { timeoutMs = TIMEOUT_MS } = {}) {
  const body = String(source ?? '')
  if (body.length > 8_000) throw new Error('Script is longer than 8000 characters.')
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  })
  const answerBox = { value: undefined }
  const factory = vm.compileFunction(
    `const invoke = async (name, args) => host(name, args)
    const wrap = name => async (...args) => invoke(name, args)
    return {
      ${PARAMS.filter(name => name !== 'done').map(name => `${name}: wrap(${JSON.stringify(name)})`).join(',\n')},
      done: (value) => { answerBox.value = value },
    }`,
    ['host', 'answerBox'],
    { parsingContext: context },
  )
  const host = async (name, args) => {
    const fn = calls?.[name]
    if (typeof fn !== 'function') throw new Error(`Unknown browser helper ${name}`)
    return fn(...(Array.isArray(args) ? args : []))
  }
  const bound = factory(host, answerBox)
  // The wrapper is the function body, so a script cannot close it and run outside
  // the sandbox. await works because the inner function is async.
  const runner = vm.compileFunction(
    `return (async () => {\n${body}\n})()`,
    PARAMS,
    { parsingContext: context },
  )
  const pending = runner(...PARAMS.map(name => bound[name]))
  pending.catch(() => {})
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Script ran longer than ${timeoutMs / 1000} seconds.`)), timeoutMs)
  })
  try {
    const value = await Promise.race([pending, timeout])
    const finalAnswer = answerBox.value ?? value
    return finalAnswer === undefined ? 'Script finished without done().' : String(finalAnswer)
  } finally {
    clearTimeout(timer)
  }
}

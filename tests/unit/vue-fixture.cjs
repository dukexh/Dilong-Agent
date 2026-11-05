/** Compile the checked-in Vue SFC, exercising its real setup and template without React or a DOM renderer. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

module.exports.loadVue = function loadVue(filename, globals = {}) {
  const absolute = path.resolve(__dirname, '../..', filename), { descriptor } = parse(fs.readFileSync(absolute, 'utf8'), { filename: absolute })
  const script = compileScript(descriptor, { id: 'unit-vue-fixture' })
  const template = compileTemplate({ id: 'unit-vue-fixture', source: descriptor.template.content, filename: absolute, compilerOptions: { bindingMetadata: script.bindings } })
  if (template.errors.length) throw Error(template.errors.join('\n'))
  const mounted = [], unmounted = [], effects = []
  // This fixture reads VNodes and calls their real state handlers. DOM directive mounting
  // (for example v-model writing an input element) belongs to the browser regression suite.
  const vue = { ...Vue, withDirectives: vnode => vnode, onMounted: action => mounted.push(action), onBeforeUnmount: action => unmounted.push(action), watch: (...args) => { const stop = Vue.watch(...args); effects.push(stop); return stop } }
  const sandbox = { console: { ...console, warn() {} }, Promise, Math, Number, String, Array, Object, Date, Boolean, Error, RegExp, JSON, Set, Map, Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, ArrayBuffer, DataView, Blob, DOMException, AbortController, TextEncoder, TextDecoder, setTimeout, clearTimeout, ...globals }
  const customRequire = name => name === 'vue' ? vue : name === 'lucide-vue-next' ? new Proxy({}, { get: (_, key) => ({ name: String(key) }) }) : name.endsWith('.vue') ? { default: { name } } : name.startsWith('.') ? require(path.resolve(path.dirname(absolute), name)) : require(name)
  function evaluate(content) {
    const module = { exports: {} }, javascript = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(javascript, { ...sandbox, exports: module.exports, module, require: customRequire }, { filename: absolute })
    return module.exports
  }
  const Component = evaluate(script.content).default, renderTemplate = evaluate(template.code).render
  function setup(props = {}, emit = () => {}) {
    const state = Component.setup(props, { expose() {}, emit })
    return { state, render: () => renderTemplate({}, [], props, Vue.proxyRefs(state), {}, {}), dispose: () => effects.splice(0).forEach(stop => stop()), mounted, unmounted }
  }
  return { setup, template: descriptor.template.content }
}
module.exports.findNode = function findNode(tree, predicate) {
  if (Array.isArray(tree)) { for (const child of tree) { const found = module.exports.findNode(child, predicate); if (found) return found }; return null }
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  const children = tree.children
  if (children && typeof children === 'object' && !Array.isArray(children)) for (const value of Object.values(children)) if (typeof value === 'function') { const found = module.exports.findNode(value(), predicate); if (found) return found }
  return module.exports.findNode(children, predicate)
}
module.exports.textContent = function textContent(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(module.exports.textContent).join('')
  return node && typeof node === 'object' ? module.exports.textContent(node.children) : ''
}

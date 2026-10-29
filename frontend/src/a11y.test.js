import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// vitest runs from frontend/ (the jsdom environment has no file:// import.meta.url)
const SRC = resolve('src')

function vueFiles() {
  return readdirSync(SRC, { recursive: true })
    .filter(name => name.endsWith('.vue'))
    .map(name => join(SRC, name))
}

// Returns the opening-tag text for every <input>, <select> and <textarea>,
// skipping over quoted attribute values (they may contain `>` in expressions).
function controlTags(source) {
  const found = []
  const start = /<(input|select|textarea)\b/g
  let match
  while ((match = start.exec(source))) {
    let i = match.index + match[0].length
    let quote = null
    for (; i < source.length; i++) {
      const ch = source[i]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
      } else if (ch === '>') {
        break
      }
    }
    found.push({ index: match.index, tag: source.slice(match.index, i + 1) })
  }
  return found
}

function insideOpenLabel(source, index) {
  const before = source.slice(0, index)
  return before.lastIndexOf('<label') > before.lastIndexOf('</label>')
}

// Every form control needs an accessible name: a <label for>/wrapping <label>,
// or an aria-label / aria-labelledby when there is no visible label.
describe('form controls are labelled', () => {
  it('gives every input, select and textarea an accessible name', () => {
    const offenders = []
    let scanned = 0
    for (const file of vueFiles()) {
      const source = readFileSync(file, 'utf8')
      for (const { index, tag } of controlTags(source)) {
        scanned++
        if (/\btype="hidden"/.test(tag)) continue
        const named = /(^|\s):?id=/.test(tag) || /(^|\s):?aria-label(ledby)?=/.test(tag)
        if (!named && !insideOpenLabel(source, index)) {
          const line = source.slice(0, index).split('\n').length
          offenders.push(`${relative(SRC, file)}:${line}`)
        }
      }
    }
    expect(scanned).toBeGreaterThan(80) // guards against the scanner silently matching nothing
    expect(offenders).toEqual([])
  })
})

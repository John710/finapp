// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from './sanitizeSvg.js'

describe('sanitizeSvg', () => {
  it('keeps plain shapes', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>')
    expect(out).toContain('<path')
  })

  it('removes scripts and event handlers', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><circle onclick="x()" r="1"/></svg>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('onclick')
  })

  it('removes <style> blocks', () => {
    const out = sanitizeSvg('<svg><style>@import url(//evil.example/x.css)</style><circle r="1"/></svg>')
    expect(out).not.toContain('<style')
    expect(out).not.toContain('evil.example')
  })

  it('removes <a> links but keeps their content', () => {
    const out = sanitizeSvg('<svg><a href="javascript:alert(1)"><circle r="1"/></a></svg>')
    expect(out).not.toContain('<a')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<circle')
  })

  it('returns an empty string for empty input', () => {
    expect(sanitizeSvg('')).toBe('')
    expect(sanitizeSvg(null)).toBe('')
  })
})

import DOMPurify from 'dompurify'

export function sanitizeSvg(input) {
  if (!input) return ''
  return DOMPurify.sanitize(input, { USE_PROFILES: { svg: true, svgFilters: true } })
}

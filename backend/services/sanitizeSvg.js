// isomorphic-dompurify v4 exports the configured DOMPurify instance directly
// (the createDOMPurify factory was removed in v3 -> v4)
import DOMPurify from 'isomorphic-dompurify'

export function sanitizeSvg(input) {
  if (!input || typeof input !== 'string') return null
  return DOMPurify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true }
  })
}

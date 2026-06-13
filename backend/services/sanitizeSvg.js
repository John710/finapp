import createDOMPurify from 'isomorphic-dompurify'

const DOMPurify = createDOMPurify()

export function sanitizeSvg(input) {
  if (!input || typeof input !== 'string') return null
  return DOMPurify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true }
  })
}

import DOMPurify from 'dompurify'

export function sanitizeSvg(input) {
  if (!input) return ''
  return DOMPurify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // The svg profile still allows <style> (CSS exfiltration / UI redress) and
    // <a> (javascript:/external navigation); icons need neither.
    FORBID_TAGS: ['style', 'a']
  })
}

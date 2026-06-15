const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV

export const logger = {
  log: (...args) => { if (isDev) console.log(...args) },
  warn: (...args) => { if (isDev) console.warn(...args) },
  error: (...args) => { if (isDev) console.error(...args) }
}

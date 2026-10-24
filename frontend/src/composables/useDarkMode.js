// useDarkMode is a thin alias of useTheme so every component reads the same
// reactive theme state. Previously this composable duplicated useTheme by
// observing <html> class mutations with a MutationObserver.
export { useTheme as useDarkMode } from './useTheme.js'

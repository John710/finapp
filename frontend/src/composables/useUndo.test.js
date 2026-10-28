import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useUndo } from './useUndo.js'

describe('useUndo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
  })

  it('shows an entry pushed into the same string scope', () => {
    const view = useUndo('accounts')
    const layout = useUndo('accounts')
    view.push({ message: 'Deleted', action: () => {} })
    expect(layout.toast.value).toEqual({ message: 'Deleted' })
  })

  it('a reactive scope follows the route instead of the first page', () => {
    const route = ref('transactions')
    const layout = useUndo(() => route.value)
    const budgetsView = useUndo('budgets')

    // Layout was mounted on /transactions, the user then opened /budgets
    route.value = 'budgets'
    budgetsView.push({ message: 'Budget deleted', action: () => {} })
    expect(layout.toast.value).toEqual({ message: 'Budget deleted' })

    // Leaving the page hides the bar
    route.value = 'debts'
    expect(layout.toast.value).toBeNull()
  })

  it('runs the action of the current scope only', () => {
    const route = ref('budgets')
    const layout = useUndo(() => route.value)
    const action = vi.fn()
    const other = vi.fn()
    useUndo('budgets').push({ message: 'a', action })
    useUndo('debts').push({ message: 'b', action: other })

    layout.undo()
    expect(action).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    expect(layout.toast.value).toBeNull()
  })

  it('dismiss clears only the current scope', () => {
    const route = ref('budgets')
    const layout = useUndo(() => route.value)
    useUndo('budgets').push({ message: 'a', action: () => {} })
    useUndo('debts').push({ message: 'b', action: () => {} })

    layout.dismiss()
    expect(layout.toast.value).toBeNull()
    route.value = 'debts'
    expect(layout.toast.value).toEqual({ message: 'b' })
  })
})

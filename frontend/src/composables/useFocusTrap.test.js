// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BaseModal from '@/components/BaseModal.vue'

let frames = []

function flushFrames() {
  const pending = frames
  frames = []
  pending.forEach(({ cb }) => cb())
}

function mountModal(open) {
  return mount(BaseModal, {
    props: { modelValue: open },
    slots: { default: '<button>ok</button>' },
    attachTo: document.body
  })
}

describe('useFocusTrap (via BaseModal)', () => {
  beforeEach(() => {
    frames = []
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      const entry = { id: ++id, cb }
      frames.push(entry)
      return entry.id
    })
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      frames = frames.filter(f => f.id !== id)
    })
    document.body.style.overflow = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('mounting a closed modal does not unlock the page scroll', async () => {
    document.body.style.overflow = 'hidden' // e.g. another modal is open
    const closed = mountModal(false)
    await nextTick()
    flushFrames()
    expect(document.body.style.overflow).toBe('hidden')
    closed.unmount()
  })

  it('locks scroll when opened and unlocks when closed', async () => {
    const modal = mountModal(false)
    await modal.setProps({ modelValue: true })
    flushFrames()
    expect(document.body.style.overflow).toBe('hidden')
    await modal.setProps({ modelValue: false })
    expect(document.body.style.overflow).toBe('')
    modal.unmount()
  })

  it('keeps the scroll locked while an outer modal is still open', async () => {
    const outer = mountModal(true)
    await nextTick()
    flushFrames()
    const inner = mountModal(false)
    await inner.setProps({ modelValue: true })
    flushFrames()

    await inner.setProps({ modelValue: false })
    expect(document.body.style.overflow).toBe('hidden')

    await outer.setProps({ modelValue: false })
    expect(document.body.style.overflow).toBe('')
    inner.unmount()
    outer.unmount()
  })

  it('a frame queued before close does not lock the page afterwards', async () => {
    const modal = mountModal(false)
    await modal.setProps({ modelValue: true })
    // Closed again before the animation frame fires
    await modal.setProps({ modelValue: false })
    flushFrames()
    expect(document.body.style.overflow).toBe('')
    modal.unmount()
  })
})

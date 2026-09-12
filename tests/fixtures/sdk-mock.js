// Only injected by browser tests; never imported into the app bundle.
class Container { constructor(data) { Object.assign(this, data) } }
export const TextContainerProperty = Container
export const CreateStartUpPageContainer = Container
export const TextContainerUpgrade = Container
export const AudioInputSource = { Glasses: 'glasses', Phone: 'phone' }
export const OsEventTypeList = { CLICK_EVENT: 0, SCROLL_TOP_EVENT: 1, SCROLL_BOTTOM_EVENT: 2, DOUBLE_CLICK_EVENT: 3, SYSTEM_EXIT_EVENT: 6, ABNORMAL_EXIT_EVENT: 7 }
let listener, audioTimer
window.__g2test = { micOn: false, opens: 0, closes: 0, renders: [], exited: false, emit: event => listener?.(event) }
const bridge = {
  async createStartUpPageContainer() { return 0 },
  async textContainerUpgrade(container) { window.__g2test.renders.push(container.content); return true },
  async audioControl(open) {
    if (open && window.__micDelay) await new Promise(resolve => setTimeout(resolve, window.__micDelay))
    clearInterval(audioTimer)
    window.__g2test.micOn = open
    if (open) {
      window.__g2test.opens++
      audioTimer = setInterval(() => listener?.({ audioEvent: { source: 'glasses', audioPcm: new Uint8Array(3200) } }), 100)
    } else window.__g2test.closes++
    return true
  },
  onEvenHubEvent(callback) { listener = callback; return () => { listener = undefined } },
  async shutDownPageContainer() { window.__g2test.exited = true; clearInterval(audioTimer); return true },
}
export async function waitForEvenAppBridge() { return bridge }

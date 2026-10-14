/**
 * Which one button sits at the right of the Inbox composer — like
 * WhatsApp, there is one, and it changes with what you are doing:
 *
 *   mic         nothing typed: hold to record, double-click for hands-free
 *               (while recording, the same button is the stop button)
 *   send        something typed
 *   send-voice  a recording is waiting in the preview
 *
 * Pure, so the rule is tested without a browser.
 */

export type ComposerButton = 'mic' | 'send' | 'send-voice'

export function composerButton(state: {
  text: string
  recording: boolean
  preparing: boolean
  hasVoiceDraft: boolean
}): ComposerButton {
  if (state.hasVoiceDraft) return 'send-voice'
  // A recording in progress keeps its stop button even if text appears
  // behind it — the control that started it must be the one that ends it.
  if (state.recording || state.preparing) return 'mic'
  return state.text.trim() ? 'send' : 'mic'
}

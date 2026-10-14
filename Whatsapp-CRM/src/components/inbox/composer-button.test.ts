import { describe, expect, it } from 'vitest'
import { composerButton } from './composer-button'

const idle = { text: '', recording: false, preparing: false, hasVoiceDraft: false }

describe('the composer button', () => {
  it('is the mic while nothing is typed', () => {
    expect(composerButton(idle)).toBe('mic')
    expect(composerButton({ ...idle, text: '   \n ' })).toBe('mic')
  })

  it('turns into Send as soon as something is typed', () => {
    expect(composerButton({ ...idle, text: 'Hello' })).toBe('send')
  })

  it('stays the stop button while recording or preparing the recording', () => {
    expect(composerButton({ ...idle, recording: true })).toBe('mic')
    expect(composerButton({ ...idle, preparing: true, text: 'typed meanwhile' })).toBe('mic')
  })

  it('sends the recording once it is waiting in the preview', () => {
    expect(composerButton({ ...idle, hasVoiceDraft: true })).toBe('send-voice')
    expect(composerButton({ ...idle, hasVoiceDraft: true, text: 'draft text' })).toBe('send-voice')
  })
})

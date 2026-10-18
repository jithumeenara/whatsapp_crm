import { describe, expect, it } from 'vitest'
import { carriedTriggerVars, triggerVars } from './trigger-vars'

describe('the message that started a chatbot, as variables', () => {
  it('keeps typed text, and says it was typed', () => {
    expect(triggerVars({ kind: 'text', text: 'Hotel Management fees?', meta_message_id: 'wamid.1' }, 'whatsapp'))
      .toEqual({ trigger_message: 'Hotel Management fees?', trigger_type: 'text', trigger_channel: 'whatsapp' })
  })

  it('marks a voice note’s transcript as voice', () => {
    expect(triggerVars({ kind: 'text', text: 'admission details', meta_message_id: 'wamid.2', was_voice: true }).trigger_type).toBe('voice')
  })

  it('keeps the title of a tapped button', () => {
    expect(triggerVars({ kind: 'interactive_reply', reply_id: 'btn_1', reply_title: 'Courses', meta_message_id: 'wamid.3' }, 'instagram'))
      .toEqual({ trigger_message: 'Courses', trigger_type: 'button', trigger_channel: 'instagram' })
  })

  it('a submitted form and the assistant starting a bot have no customer words', () => {
    expect(triggerVars({ kind: 'flow_reply', flow_token: 't', response: {}, meta_message_id: 'wamid.4' })).toEqual({ trigger_message: '', trigger_type: 'form' })
    expect(triggerVars({ kind: 'text', text: '', meta_message_id: 'assistant:123' }).trigger_type).toBe('assistant')
  })

  it('a linked chatbot gets only the trigger variables of the first', () => {
    expect(carriedTriggerVars({ trigger_message: 'Hi', trigger_type: 'text', name: 'Anu', trigger_channel: 'website' }))
      .toEqual({ trigger_message: 'Hi', trigger_type: 'text', trigger_channel: 'website' })
  })
})

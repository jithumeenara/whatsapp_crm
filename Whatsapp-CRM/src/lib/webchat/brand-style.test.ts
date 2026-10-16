import { describe, expect, it } from 'vitest'
import { parseWidgetPatch } from './settings'
import { publicWidget, publicWidgetStyle } from './widget-config'

describe('brand colour: solid or gradient, and a button animation', () => {
  it('accepts a gradient with a second colour, and an animation', () => {
    expect(parseWidgetPatch({ color_style: 'gradient', secondary_color: '#9333EA', launcher_animation: 'pulse' })).toEqual({
      ok: true,
      patch: { color_style: 'gradient', secondary_color: '#9333ea', launcher_animation: 'pulse' },
    })
  })

  it('clears the second colour back to "a darker shade"', () => {
    expect(parseWidgetPatch({ secondary_color: '' })).toEqual({ ok: true, patch: { secondary_color: null } })
    expect(parseWidgetPatch({ secondary_color: null })).toEqual({ ok: true, patch: { secondary_color: null } })
  })

  it('refuses anything that is not one of the choices', () => {
    expect(parseWidgetPatch({ color_style: 'rainbow' }).ok).toBe(false)
    expect(parseWidgetPatch({ secondary_color: 'red' }).ok).toBe(false)
    expect(parseWidgetPatch({ secondary_color: '#fff;background:url(x)' }).ok).toBe(false)
    expect(parseWidgetPatch({ launcher_animation: 'explode' }).ok).toBe(false)
  })

  // The values end up in CSS on the business's own website: a bad row
  // must never reach it as written.
  it('serves only safe values to the website', () => {
    expect(publicWidgetStyle({ color_style: 'weird', secondary_color: 'url(evil)', launcher_animation: 'explode' })).toEqual({
      color_style: 'gradient',
      secondary_color: null,
      launcher_animation: 'none',
    })
  })

  it('sends style alongside the existing config', () => {
    const w = publicWidget({
      public_key: 'wk_x', title: 't', welcome_message: 'hi', primary_color: '#da2727', position: 'right', logo_url: null,
      allow_handoff: true, color_style: 'solid', secondary_color: null, launcher_animation: 'glow',
    })
    expect(w).toMatchObject({ key: 'wk_x', primary_color: '#da2727', color_style: 'solid', launcher_animation: 'glow' })
  })
})

import { describe, expect, it } from 'vitest'
import { disabledApi, disabledApiMessage, isApiDisabled } from './api-disabled'

const GOOGLE =
  'Google Drive API has not been used in project 482910372615 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=482910372615 then retry.'

describe('an API switched off in Google Cloud', () => {
  it('is recognised from Google’s message', () => {
    expect(isApiDisabled(GOOGLE)).toBe(true)
    expect(isApiDisabled('Requested entity was not found.')).toBe(false)
  })

  it('links straight to that API’s Enable page, in the right project', () => {
    expect(disabledApi(GOOGLE, 'Google Drive API')).toEqual({
      api: 'Google Drive API',
      enableUrl: 'https://console.cloud.google.com/apis/library/drive.googleapis.com?project=482910372615',
    })
    expect(disabledApi('is disabled', 'Gmail API').enableUrl).toBe('https://console.cloud.google.com/apis/library/gmail.googleapis.com')
    expect(disabledApiMessage(disabledApi(GOOGLE, 'Google Drive API'))).toContain('drive.googleapis.com?project=482910372615')
  })
})

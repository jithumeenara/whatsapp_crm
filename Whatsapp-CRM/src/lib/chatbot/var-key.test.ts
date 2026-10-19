import { describe, expect, it } from 'vitest'
import { isReservedVarKey, isValidVarKey, toVarKey } from './var-key'

describe('variable names', () => {
  it('turns what people type into a name templates can read', () => {
    expect(toVarKey('Course Name')).toBe('course_name')
    expect(toVarKey('  reg-no. ')).toBe('reg_no')
    expect(toVarKey('ജില്ല')).toBe('')
  })
  it('checks a saved name', () => {
    expect(isValidVarKey('course_name')).toBe(true)
    expect(isValidVarKey('course name')).toBe(false)
  })
  it('knows the names the chatbot fills in itself', () => {
    expect(isReservedVarKey('trigger_message')).toBe(true)
    expect(isReservedVarKey('sheet_name')).toBe(true)
    expect(isReservedVarKey('district')).toBe(false)
  })
})

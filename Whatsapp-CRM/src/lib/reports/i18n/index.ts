/**
 * Report text in the business's chosen language (Settings → Report language),
 * English by default and whenever a language or a key is unknown.
 *
 * Each language file must give every key (TypeScript enforces it) and the same
 * {placeholders} (i18n.test.ts). A language is offered in Settings only if it
 * has a dictionary here (also tested), so a chosen language always works.
 */
import { en, type Dict, type Key } from './en'
import { ml } from './ml'
import { hi } from './hi'
import { ta } from './ta'
import { te } from './te'
import { kn } from './kn'
import { bn } from './bn'
import { ar } from './ar'

export type { Key }

export const DICTIONARIES: Record<string, Dict> = { en, ml, hi, ta, te, kn, bn, ar }

/** Languages written right to left. */
export const RTL_LANGUAGES = new Set(['ar'])

export function isRtlLanguage(lang: string): boolean {
  return RTL_LANGUAGES.has(lang)
}

export function dictionaryFor(lang: string | null | undefined): Dict {
  return DICTIONARIES[lang ?? ''] ?? en
}

/** The text for a key, with {name} placeholders filled in. */
export function t(lang: string | null | undefined, key: Key, params: Record<string, string | number> = {}): string {
  const text = dictionaryFor(lang)[key] ?? en[key]
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

/**
 * Meta templates can declare variables two ways:
 *   - Positional: {{1}}, {{2}}, ... — the classic/default format.
 *   - Named: {{customer_name}}, {{company_name}}, ... — an alternative
 *     format Meta added later ("named parameters"), selectable when a
 *     template is created in Business Manager. A template uses ONE
 *     format consistently; Meta doesn't mix them within a template.
 *
 * `extractVariableIndices` (template-validators.ts) only recognizes the
 * positional form, because this app's OWN template-creation flow always
 * writes positional templates. But templates SYNCED from Meta may use
 * either format, and sending a named-variable template requires each
 * body/header parameter object to carry `parameter_name` instead of
 * relying on array position — get this wrong and Meta silently drops
 * the values (or rejects the send), leaving raw "{{customer_name}}" in
 * the message the customer receives.
 *
 * These helpers extract whichever form is actually present, generically.
 */

/** Every distinct {{...}} key in a string, in first-appearance order. */
export function extractVariableKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const m of matches) {
    const key = m.slice(2, -2).trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** "1", "2", ... vs "customer_name", "company_name", ... */
export function isPositionalKey(key: string): boolean {
  return /^\d+$/.test(key);
}

/** True when the text's variables use Meta's named-parameter format. */
export function isNamedVariableText(text: string | null | undefined): boolean {
  const keys = extractVariableKeys(text);
  return keys.length > 0 && keys.some((k) => !isPositionalKey(k));
}

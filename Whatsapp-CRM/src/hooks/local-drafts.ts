/**
 * Unsent email drafts kept in this browser (see email-composer). They hold
 * customer addresses and message text, so they leave with the person who
 * wrote them: signing out wipes them, and the next person to sign in on a
 * shared computer does not find them.
 */
export const EMAIL_DRAFT_PREFIX = "email-draft:";

export function clearEmailDrafts(storage: Pick<Storage, "length" | "key" | "removeItem"> | null = safeLocalStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(EMAIL_DRAFT_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    /* storage blocked: nothing was kept */
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

import DOMPurify from 'isomorphic-dompurify';

/**
 * The HTML a table's "HTML block" field shows inside the record form.
 *
 * Whoever edits the table writes it, and everyone who opens a record of
 * that table sees it, inside the signed-in CRM. So it may format text
 * and link out, but it may not bring its own form (a fake "session
 * expired, sign in again" box posting somewhere else) or a <style> /
 * <base> that restyles or re-points the rest of the page. DOMPurify's
 * defaults already drop scripts, event handlers, javascript: links and
 * `target`, so a link cannot keep a handle on the CRM tab.
 */
const FORBID_TAGS = ['form', 'input', 'button', 'textarea', 'select', 'option', 'style', 'link', 'meta', 'base'];
const FORBID_ATTR = ['action', 'formaction'];

export function sanitizeHtmlBlock(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS, FORBID_ATTR });
}

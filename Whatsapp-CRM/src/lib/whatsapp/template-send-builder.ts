/**
 * Build the Meta `components` array used by POST /{phone_number_id}/messages
 * when sending an APPROVED template.
 *
 * Distinct from `template-components.ts` — that module builds the
 * `components` for TEMPLATE CREATION (where you describe headers,
 * footers, buttons, examples). This module builds the per-send
 * `components` (where you fill in variable values and supply the
 * actual media link or button URL suffix for THIS specific delivery).
 *
 * Auto-fills as much as possible from the template row so callers
 * only need to supply values for the variable-bearing fields:
 *
 *   - Static IMAGE/VIDEO/DOCUMENT headers ride along automatically
 *     using the template's `header_media_url` (or `header_handle`).
 *     Meta requires the media component on every send even though
 *     the URL hasn't changed since approval.
 *   - TEXT headers with `{{1}}` need `headerText` from the caller.
 *   - Body variables come in as `body: string[]`, indexed by {{N}}.
 *   - URL buttons with `{{1}}` need `buttonUrlParams[i]` keyed by
 *     button index. URL buttons without variables, plus QUICK_REPLY
 *     and PHONE_NUMBER buttons, don't need send-time parameters.
 *   - COPY_CODE buttons need the actual code to display. We fall
 *     back to the template's `example` value if the caller doesn't
 *     override — that matches the most common use case (a static
 *     promo code) without forcing UI work.
 *
 * Validation throws here (not at the Meta API boundary) so a missing
 * sample surfaces as "Header text variable {{1}} requires a value",
 * not a 400 from Meta that doesn't say which field broke.
 */

import type { MessageTemplate, TemplateButton } from '@/types';
import { extractVariableIndices } from './template-validators';
import { extractVariableKeys, isPositionalKey } from './template-variable-keys';

export interface SendTimeParams {
  /** Values for body {{1}}, {{2}}, … indexed by variable position.
   *  Used when the template's body uses Meta's positional format. */
  body?: string[];
  /** Values keyed by variable name (e.g. "customer_name"), for a body
   *  that uses Meta's named-parameter format instead of positional. */
  bodyByName?: Record<string, string>;
  /** Value for TEXT-header {{1}}, when the header has a variable.
   *  Used for both positional and named header variables — a header
   *  can only ever carry a single variable, so no by-name map is needed. */
  headerText?: string;
  /** Override the template's static media URL for this send. */
  headerMediaUrl?: string;
  /** Alternative: send the media by Meta media id (from prior upload). */
  headerMediaId?: string;
  /**
   * Per-button overrides keyed by the button's index in the
   * template's `buttons` array. Used for URL buttons with a {{1}}
   * suffix and for COPY_CODE buttons whose example you want to
   * override at send time.
   */
  buttonParams?: Record<number, string>;
}

export type MetaSendComponent =
  | { type: 'header'; parameters: MetaSendParameter[] }
  | { type: 'body'; parameters: MetaSendParameter[] }
  | {
      type: 'button';
      sub_type: 'url' | 'quick_reply' | 'copy_code' | 'flow';
      index: string;
      parameters: MetaSendParameter[];
    };

type MetaSendParameter =
  | { type: 'text'; text: string; parameter_name?: string }
  | { type: 'image'; image: { link?: string; id?: string } }
  | { type: 'video'; video: { link?: string; id?: string } }
  | { type: 'document'; document: { link?: string; id?: string } }
  | { type: 'coupon_code'; coupon_code: string }
  | { type: 'payload'; payload: string }
  | { type: 'action'; action: { flow_token: string } };

function buildHeaderComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const headerType = template.header_type;
  if (!headerType) return null;

  if (headerType === 'text') {
    // TEXT header with a variable → need a value. Static text headers
    // (no variables) just ride along inside the template itself; no
    // header component required on send.
    const headerKeys = extractVariableKeys(template.header_content);
    if (headerKeys.length === 0) return null;
    const value = params.headerText;
    if (!value || !value.trim()) {
      throw new Error(
        'Header text variable {{1}} requires a value — pass headerText.',
      );
    }
    const key = headerKeys[0];
    return {
      type: 'header',
      parameters: [
        isPositionalKey(key)
          ? { type: 'text', text: value }
          : { type: 'text', parameter_name: key, text: value },
      ],
    };
  }

  // image / video / document — Meta requires the media component on
  // every send. Prefer the caller's explicit override; otherwise fall
  // back to the template's own stored sample URL.
  //
  // Deliberately NOT falling back to template.header_handle here: that
  // handle is a Resumable-Upload session id from when the template was
  // first SUBMITTED for approval — it is not a valid media id for the
  // send-message endpoint, and Meta rejects it. A real send-time id can
  // only come from an explicit params.headerMediaId (from the Media
  // Upload API), never from the template row itself.
  const link = params.headerMediaUrl ?? template.header_media_url;
  const id = params.headerMediaId;
  if (!link && !id) {
    throw new Error(
      `${headerType} header requires a media link or id at send time — set header_media_url on the template or pass headerMediaUrl/headerMediaId.`,
    );
  }
  const mediaPayload: { link?: string; id?: string } = id ? { id } : { link };
  return {
    type: 'header',
    parameters: [
      headerType === 'image'
        ? { type: 'image', image: mediaPayload }
        : headerType === 'video'
          ? { type: 'video', video: mediaPayload }
          : { type: 'document', document: mediaPayload },
    ],
  };
}

function buildBodyComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const keys = extractVariableKeys(template.body_text);
  if (keys.length === 0) return null;

  if (keys.some((k) => !isPositionalKey(k))) {
    // Named-parameter body — each value is looked up by name, not by
    // array position. Order doesn't matter; Meta matches by parameter_name.
    const map = params.bodyByName ?? {};
    const missing = keys.filter((k) => !map[k]?.toString().trim());
    if (missing.length > 0) {
      throw new Error(
        `Body variable(s) ${missing.join(', ')} require a value — pass bodyByName.`,
      );
    }
    return {
      type: 'body',
      parameters: keys.map((k) => ({ type: 'text', parameter_name: k, text: String(map[k]) })),
    };
  }

  // Positional — unchanged legacy behaviour.
  const varCount = keys.length;
  const body = params.body ?? [];
  if (body.length < varCount) {
    throw new Error(
      `Body has ${varCount} variable(s) but only ${body.length} value(s) were supplied.`,
    );
  }
  // Trim to the variable count — extra values are dropped silently so
  // a legacy caller that passes too many doesn't error out.
  const values = body.slice(0, varCount);
  return {
    type: 'body',
    parameters: values.map((text) => ({ type: 'text', text: String(text) })),
  };
}

function buttonNeedsSendParam(
  button: TemplateButton,
  override: string | undefined,
): boolean {
  switch (button.type) {
    case 'URL':
      return extractVariableIndices(button.url).length > 0;
    case 'COPY_CODE':
      return true;
    case 'FLOW':
      // Meta requires a flow_token for every FLOW button send
      return true;
    case 'QUICK_REPLY':
    case 'PHONE_NUMBER':
      return override !== undefined;
  }
}

function buildButtonComponent(
  button: TemplateButton,
  index: number,
  override: string | undefined,
): MetaSendComponent | null {
  if (!buttonNeedsSendParam(button, override)) return null;

  switch (button.type) {
    case 'URL': {
      // Each URL button is its own component with sub_type=url and
      // the button's index in the template's buttons array.
      if (!override || !override.trim()) {
        throw new Error(
          `URL button #${index + 1} uses {{1}} — requires a buttonParams[${index}] value.`,
        );
      }
      return {
        type: 'button',
        sub_type: 'url',
        index: String(index),
        parameters: [{ type: 'text', text: override }],
      };
    }
    case 'COPY_CODE': {
      const code = override?.trim() || button.example;
      return {
        type: 'button',
        sub_type: 'copy_code',
        index: String(index),
        parameters: [{ type: 'coupon_code', coupon_code: code }],
      };
    }
    case 'QUICK_REPLY': {
      // Only included when the caller explicitly overrides the
      // payload (rare — usually QR buttons use their default text).
      return {
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: override! }],
      };
    }
    case 'PHONE_NUMBER':
      return null;
    case 'FLOW': {
      // Meta requires a flow_token per send — use caller's override or generate a unique one.
      const flowToken = override?.trim() || crypto.randomUUID();
      return {
        type: 'button',
        sub_type: 'flow',
        index: String(index),
        parameters: [{ type: 'action', action: { flow_token: flowToken } }],
      };
    }
  }
}

/**
 * Build the full `components` array for the send-message payload.
 * Returns an empty array when the template is fully static (no
 * variables, no media header), which is a valid Meta request.
 */
export function buildSendComponents(
  template: MessageTemplate,
  params: SendTimeParams = {},
): MetaSendComponent[] {
  const out: MetaSendComponent[] = [];
  const header = buildHeaderComponent(template, params);
  if (header) out.push(header);
  const body = buildBodyComponent(template, params);
  if (body) out.push(body);
  if (template.buttons?.length) {
    template.buttons.forEach((btn, i) => {
      const override = params.buttonParams?.[i];
      const component = buildButtonComponent(btn, i, override);
      if (component) out.push(component);
    });
  }
  return out;
}

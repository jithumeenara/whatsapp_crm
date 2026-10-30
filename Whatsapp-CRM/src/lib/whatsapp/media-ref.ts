import { readFile } from "fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "path";
import { lookup as mimeLookup } from "mime-types";
import { uploadMediaToMeta } from "./meta-api";

const UPLOADS_DIR = resolve(process.cwd(), "uploads");

/**
 * Meta's send API needs either a real, publicly-fetchable URL (`link`) or
 * a media id from Meta's own Media Upload API (`id`) — it does NOT accept
 * a relative path like this app's own `/api/files/...` upload URLs, since
 * those only resolve against our origin inside a browser, never from
 * Meta's servers. Sending one as `link` fails with:
 *   "(#100) Param template.components.parameters.image.link is not a valid URI."
 *
 * A local `/api/files/...` link is uploaded to Meta directly so it works
 * even when the server isn't (or might not be) publicly reachable — the
 * same approach engineSendMedia (meta-send.ts) already uses for chatbot
 * media sends. A real absolute http(s) URL is passed through as-is.
 */
export class MediaPathError extends Error {}

/**
 * The file on disk behind one of this app's `/api/files/...` links, or an
 * error. Same rule as GET /api/files: it must stay inside uploads/, and a
 * file in a per-account folder (`account-<id>/`) belongs to that account
 * only — the check is made on the resolved path, so `..` and `./` cannot
 * walk into another account's folder. Files from before per-account
 * folders keep the old rule (any account member could already open them).
 */
export function uploadPathFor(link: string, accountId: string | null | undefined): string {
  let rel: string
  try {
    rel = decodeURIComponent(link.replace(/^\/api\/files\//, "").split("?")[0]);
  } catch {
    throw new MediaPathError("Invalid media file path");
  }
  const filePath = resolve(UPLOADS_DIR, rel);
  const inside = relative(UPLOADS_DIR, filePath);
  if (!inside || isAbsolute(inside) || inside.startsWith("..")) throw new MediaPathError("Invalid media file path");
  const top = inside.split(sep)[0];
  if (accountId !== undefined && top.startsWith("account-") && top !== `account-${accountId}`) {
    throw new MediaPathError("That file is not this account's.");
  }
  return filePath;
}

/**
 * `accountId` is the sending account: pass it whenever the link could
 * have come from a person (a send box, a broadcast, a template header).
 */
export async function resolveMediaRef(
  link: string,
  phoneNumberId: string,
  accessToken: string,
  accountId?: string | null,
): Promise<{ id: string; link?: never } | { link: string; id?: never }> {
  if (/^https?:\/\//i.test(link)) return { link };

  const filePath = uploadPathFor(link, accountId ?? undefined);
  const fileBuffer = await readFile(filePath);
  const filename = basename(filePath);
  const mimeType = (mimeLookup(filename) || "application/octet-stream") as string;
  const id = await uploadMediaToMeta({ phoneNumberId, accessToken, fileBuffer, mimeType, filename });
  return { id };
}

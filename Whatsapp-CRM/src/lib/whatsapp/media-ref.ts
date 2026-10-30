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

/** A file outside every per-account folder (uploaded before they existed). */
export class LegacyMediaPathError extends MediaPathError {
  constructor(readonly filePath: string, readonly url: string) {
    super("That file is not this account's.");
  }
}

/**
 * The file on disk behind one of this app's `/api/files/...` links, or an
 * error. Same rule as GET /api/files: it must stay inside uploads/, and a
 * file in a per-account folder (`account-<id>/`) belongs to that account
 * only — the check is made on the resolved path, so `..` and `./` cannot
 * walk into another account's folder.
 *
 * `accountId` is required (security review N5): there is no way to skip
 * the folder check. A file from before per-account folders is refused here
 * (LegacyMediaPathError), because only the database can say whose it is —
 * send paths use `resolveUploadPath`, which asks it.
 */
export function uploadPathFor(link: string, accountId: string): string {
  if (typeof accountId !== "string" || !accountId) throw new MediaPathError("No sending account for this file.");
  let rel: string
  try {
    rel = decodeURIComponent(link.replace(/^\/api\/files\//, "").split("?")[0]);
  } catch {
    throw new MediaPathError("Invalid media file path");
  }
  const filePath = resolve(UPLOADS_DIR, rel);
  const inside = relative(UPLOADS_DIR, filePath);
  if (!inside || isAbsolute(inside) || inside.startsWith("..")) throw new MediaPathError("Invalid media file path");
  const parts = inside.split(sep);
  const top = parts[0];
  if (top.startsWith("account-")) {
    if (top !== `account-${accountId}`) throw new MediaPathError("That file is not this account's.");
    return filePath;
  }
  // Legacy: no account folder. The canonical URL is what file_uploads stores.
  throw new LegacyMediaPathError(filePath, `/api/files/${parts.join("/")}`);
}

/**
 * `uploadPathFor` for a send: a legacy root-level file is allowed only when
 * the database ties it to this account, or (unrecorded) when this server
 * has a single account — the same rule GET /api/files applies
 * (src/lib/files/legacy-access.ts). Everything else is refused.
 */
export async function resolveUploadPath(link: string, accountId: string): Promise<string> {
  try {
    return uploadPathFor(link, accountId);
  } catch (err) {
    if (!(err instanceof LegacyMediaPathError)) throw err;
    const { legacyFileAllowed } = await import("@/lib/files/legacy-access");
    if (await legacyFileAllowed(err.url, accountId)) return err.filePath;
    throw new MediaPathError("That file is not this account's.");
  }
}

/**
 * `accountId` is the sending account (required): its own uploads only.
 */
export async function resolveMediaRef(
  link: string,
  phoneNumberId: string,
  accessToken: string,
  accountId: string,
): Promise<{ id: string; link?: never } | { link: string; id?: never }> {
  if (/^https?:\/\//i.test(link)) return { link };

  const filePath = await resolveUploadPath(link, accountId);
  const fileBuffer = await readFile(filePath);
  const filename = basename(filePath);
  const mimeType = (mimeLookup(filename) || "application/octet-stream") as string;
  const id = await uploadMediaToMeta({ phoneNumberId, accessToken, fileBuffer, mimeType, filename });
  return { id };
}

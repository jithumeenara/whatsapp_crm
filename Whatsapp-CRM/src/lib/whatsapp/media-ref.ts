import { readFile } from "fs/promises";
import { join, basename } from "path";
import { lookup as mimeLookup } from "mime-types";
import { uploadMediaToMeta } from "./meta-api";

const UPLOADS_DIR = join(process.cwd(), "uploads");

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
export async function resolveMediaRef(
  link: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<{ id: string; link?: never } | { link: string; id?: never }> {
  if (/^https?:\/\//i.test(link)) return { link };

  const relativePath = link.replace(/^\/api\/files\//, "");
  const filePath = join(UPLOADS_DIR, relativePath);
  if (!filePath.startsWith(UPLOADS_DIR)) throw new Error("Invalid media file path");

  const fileBuffer = await readFile(filePath);
  const filename = basename(relativePath);
  const mimeType = (mimeLookup(filename) || "application/octet-stream") as string;
  const id = await uploadMediaToMeta({ phoneNumberId, accessToken, fileBuffer, mimeType, filename });
  return { id };
}

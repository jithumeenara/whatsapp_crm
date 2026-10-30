import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, resolve, relative, isAbsolute } from "path";
import { lookup } from "mime-types";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { attachmentHeaders } from "@/lib/files/account-files";

/** Read per request, not at import: the working directory is the app's. */
const uploadsDir = () => resolve(join(process.cwd(), "uploads"));

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Require authentication — uploaded files are account-scoped and must not be public
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path } = await params;

  // Every segment a plain name: no "..", ".", empty, slash, backslash or
  // NUL. The folder check below reads the first segment, so a ".." after
  // it — account-<mine>/../account-<theirs>/file — used to pass that
  // check and still stay inside uploads/, which was all the traversal
  // check asked. Refused here before anything is resolved.
  if (!Array.isArray(path) || path.length === 0 || path.some((seg) => !seg || seg === "." || seg === ".." || /[\\/\0]/.test(seg))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve the full path and confirm it stays inside UPLOADS_DIR (blocks path traversal).
  // Use relative() so this works on both Windows (backslash) and Unix (forward slash).
  const requestedPath = resolve(join(uploadsDir(), ...path));
  const rel = relative(uploadsDir(), requestedPath);
  if (!rel || isAbsolute(rel) || rel.startsWith("..")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  });
  if (!profile?.account_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A file in an account's folder is for that account only. Being signed
  // in was enough before, so anyone who had another tenant's file URL —
  // an email attachment, an ID card sent over WhatsApp — could open it.
  const top = rel.split(/[\\/]/)[0];
  if (top.startsWith("account-")) {
    if (top !== `account-${profile.account_id}`) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    // Files from before per-account folders have no folder to judge by.
    // Where the upload was recorded, its account decides; one recorded as
    // another workspace's is theirs. (Unrecorded legacy files keep the
    // old rule — see findings A3, "legacy uploads".)
    const owner = await prisma.fileUpload.findFirst({
      where: { url: `/api/files/${path.join("/")}` },
      select: { account_id: true },
    });
    if (owner && owner.account_id !== profile.account_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  try {
    const data = await readFile(requestedPath);
    const mimeType = lookup(requestedPath) || "application/octet-stream";

    // Only the types uploads are checked against are served as themselves,
    // and only media and PDFs open inline. Anything else — an old file
    // stored under a name like page.html or icon.svg — goes out as an
    // opaque, sandboxed download the browser never renders; the name is
    // encoded so a quote or newline in it cannot break the header.
    const headers: Record<string, string> = {
      ...attachmentHeaders(mimeType, path[path.length - 1]),
      "Cache-Control": "private, max-age=3600",
    };
    // Chrome will not open its PDF viewer under a sandbox CSP; a PDF's
    // script runs in the viewer, not on this origin, so it can go without.
    if (headers["Content-Type"] === "application/pdf") delete headers["Content-Security-Policy"];
    return new NextResponse(data, { headers });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

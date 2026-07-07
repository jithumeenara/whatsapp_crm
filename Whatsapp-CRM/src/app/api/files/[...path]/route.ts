import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, resolve, relative, isAbsolute } from "path";
import { lookup } from "mime-types";
import { auth } from "@/auth";

const UPLOADS_DIR = resolve(join(process.cwd(), "uploads"));

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

  // Resolve the full path and confirm it stays inside UPLOADS_DIR (blocks path traversal).
  // Use relative() so this works on both Windows (backslash) and Unix (forward slash).
  const requestedPath = resolve(join(UPLOADS_DIR, ...path));
  const rel = relative(UPLOADS_DIR, requestedPath);
  if (isAbsolute(rel) || rel.startsWith("..")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const data = await readFile(requestedPath);
    const mimeType = lookup(requestedPath) || "application/octet-stream";

    // Serve SVGs as plain text to prevent script execution
    const safeMime = mimeType === "image/svg+xml" ? "text/plain" : mimeType;

    return new NextResponse(data, {
      headers: {
        "Content-Type": safeMime,
        "Cache-Control": "private, max-age=3600",
        // Force download for non-image/non-pdf types to prevent MIME sniffing
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": safeMime.startsWith("image/") || safeMime === "application/pdf"
          ? "inline"
          : `attachment; filename="${path[path.length - 1]}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

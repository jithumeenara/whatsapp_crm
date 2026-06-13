import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { lookup } from "mime-types";

const UPLOADS_DIR = join(process.cwd(), "uploads");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // Prevent directory traversal
  const safePath = path.map((p) => p.replace(/\.\./g, "")).join("/");

  try {
    const filePath = join(UPLOADS_DIR, safePath);
    // Ensure the resolved path is still within UPLOADS_DIR
    if (!filePath.startsWith(UPLOADS_DIR)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await readFile(filePath);
    const mimeType = lookup(safePath) || "application/octet-stream";

    return new NextResponse(data, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

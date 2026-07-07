import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, extname, basename } from "path";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

const UPLOADS_DIR = join(process.cwd(), "uploads");

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/amr",
  "audio/ogg",
  "audio/opus",
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

const MAX_SIZE = 16 * 1024 * 1024; // 16 MB

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 16 MB limit" }, { status: 400 });
    }

    const ext = extname(file.name) || "";
    const safeName = basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${Date.now()}-${safeName}${ext}`;
    const accountDir = join(UPLOADS_DIR, `account-${ctx.accountId}`);

    await mkdir(accountDir, { recursive: true });

    const bytes = await file.arrayBuffer();
    await writeFile(join(accountDir, filename), Buffer.from(bytes));

    const publicUrl = `/api/files/account-${ctx.accountId}/${filename}`;

    return NextResponse.json({ url: publicUrl, filename });
  } catch (err) {
    return toErrorResponse(err);
  }
}

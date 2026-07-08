import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, extname, basename } from "path";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";

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

const MIME_CATEGORY: Record<string, string> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/3gpp": "video",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/amr": "audio",
  "audio/ogg": "audio",
  "audio/opus": "audio",
  "application/pdf": "pdf",
  "application/vnd.ms-powerpoint": "document",
  "application/msword": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "text/plain": "document",
};

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
    const storedName = `${Date.now()}-${safeName}${ext}`;
    const accountDir = join(UPLOADS_DIR, `account-${ctx.accountId}`);

    await mkdir(accountDir, { recursive: true });

    const bytes = await file.arrayBuffer();
    await writeFile(join(accountDir, storedName), Buffer.from(bytes));

    const publicUrl = `/api/files/account-${ctx.accountId}/${storedName}`;
    const category = MIME_CATEGORY[file.type] ?? "other";

    // Save to FileUpload table so it appears in File Manager
    const record = await prisma.fileUpload.create({
      data: {
        account_id: ctx.accountId,
        original_name: file.name,
        stored_name: storedName,
        file_path: join(accountDir, storedName),
        url: publicUrl,
        mime_type: file.type,
        size: file.size,
        file_category: category,
        scan_status: "ok",
      },
    });

    return NextResponse.json({ url: publicUrl, filename: storedName, id: record.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}

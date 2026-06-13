import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, extname, basename } from "path";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const MAX_SIZE = 16 * 1024 * 1024; // 16 MB per file
const MAX_FILES = 20;

const MIME_CATEGORY: Record<string, string> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/svg+xml": "image",
  "video/mp4": "video",
  "video/3gpp": "video",
  "video/quicktime": "video",
  "application/pdf": "pdf",
  "application/msword": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "text/plain": "document",
  "text/csv": "document",
};

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");
    const formData = await req.formData();

    const rawFiles = formData.getAll("files");
    const files = rawFiles.filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Max ${MAX_FILES} files per upload` }, { status: 400 });
    }

    const accountDir = join(UPLOADS_DIR, `account-${ctx.accountId}`);
    await mkdir(accountDir, { recursive: true });

    const results = [];
    const errors = [];

    for (const file of files) {
      if (!MIME_CATEGORY[file.type]) {
        errors.push({ name: file.name, error: "File type not allowed" });
        continue;
      }
      if (file.size > MAX_SIZE) {
        errors.push({ name: file.name, error: "File exceeds 16 MB limit" });
        continue;
      }

      const ext = extname(file.name) || "";
      const safeName = basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
      const storedName = `${randomUUID()}-${safeName}${ext}`;
      const filePath = join(accountDir, storedName);

      const bytes = await file.arrayBuffer();
      await writeFile(filePath, Buffer.from(bytes));

      const url = `/api/files/account-${ctx.accountId}/${storedName}`;
      const category = MIME_CATEGORY[file.type] ?? "other";

      const record = await prisma.fileUpload.create({
        data: {
          account_id: ctx.accountId,
          original_name: file.name,
          stored_name: storedName,
          file_path: filePath,
          url,
          mime_type: file.type,
          size: file.size,
          file_category: category,
          scan_status: "pending",
        },
      });

      // Fire-and-forget virus scan hook if configured
      const scanUrl = process.env.VIRUS_SCAN_WEBHOOK_URL;
      if (scanUrl) {
        fetch(scanUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_id: record.id,
            url,
            original_name: file.name,
            mime_type: file.type,
            callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/file-manager/${record.id}/scan-result`,
          }),
        }).catch(() => {});
      }

      results.push(record);
    }

    return NextResponse.json({ files: results, errors });
  } catch (err) {
    return toErrorResponse(err);
  }
}

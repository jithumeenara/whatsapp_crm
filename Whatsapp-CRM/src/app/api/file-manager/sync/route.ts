import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join, extname, basename } from "path";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";

const UPLOADS_DIR = join(process.cwd(), "uploads");

const EXT_MIME: Record<string, string> = {
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".mp4":  "video/mp4",
  ".3gp":  "video/3gpp",
  ".mov":  "video/quicktime",
  ".aac":  "audio/aac",
  ".mp3":  "audio/mpeg",
  ".ogg":  "audio/ogg",
  ".opus": "audio/opus",
  ".amr":  "audio/amr",
  ".m4a":  "audio/mp4",
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt":  "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt":  "text/plain",
  ".csv":  "text/csv",
};

const MIME_CATEGORY: Record<string, string> = {
  "image/jpeg": "image", "image/png": "image", "image/webp": "image", "image/gif": "image",
  "video/mp4": "video", "video/3gpp": "video", "video/quicktime": "video",
  "audio/aac": "audio", "audio/mpeg": "audio", "audio/ogg": "audio",
  "audio/opus": "audio", "audio/amr": "audio", "audio/mp4": "audio",
  "application/pdf": "pdf",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "text/plain": "document", "text/csv": "document",
};

export async function POST() {
  try {
    const ctx = await requireRole("agent");
    const accountDir = join(UPLOADS_DIR, `account-${ctx.accountId}`);

    let fileNames: string[];
    try {
      fileNames = await readdir(accountDir);
    } catch {
      return NextResponse.json({ synced: 0 });
    }

    // Fetch all existing stored_names so we skip what's already recorded
    const existing = await prisma.fileUpload.findMany({
      where: { account_id: ctx.accountId },
      select: { stored_name: true },
    });
    const knownNames = new Set(existing.map((e) => e.stored_name));

    let synced = 0;

    for (const storedName of fileNames) {
      if (knownNames.has(storedName)) continue;

      const ext = extname(storedName).toLowerCase();
      const mime = EXT_MIME[ext];
      if (!mime) continue;

      const filePath = join(accountDir, storedName);
      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile()) continue;

      // Recover a readable name: strip leading timestamp- or uuid- prefix
      const nameWithoutExt = basename(storedName, ext);
      const stripped = nameWithoutExt
        .replace(/^\d{10,}-/, "")          // strip unix-ms timestamp prefix  e.g. 1781146402332-
        .replace(/^[0-9a-f-]{36}-/i, "")  // strip uuid prefix
        .replace(/_/g, " ")
        .trim();
      const originalName = (stripped || nameWithoutExt) + ext;

      const url = `/api/files/account-${ctx.accountId}/${storedName}`;
      const category = MIME_CATEGORY[mime] ?? "other";

      await prisma.fileUpload.create({
        data: {
          account_id: ctx.accountId,
          original_name: originalName,
          stored_name: storedName,
          file_path: filePath,
          url,
          mime_type: mime,
          size: info.size,
          file_category: category,
          scan_status: "ok",
        },
      });
      synced++;
    }

    return NextResponse.json({ synced });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const file = await prisma.fileUpload.findFirst({
      where: { id, account_id: ctx.accountId },
    });
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ file });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const file = await prisma.fileUpload.findFirst({
      where: { id, account_id: ctx.accountId },
    });
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Delete from disk (best-effort)
    await unlink(file.file_path).catch(() => {});

    await prisma.fileUpload.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

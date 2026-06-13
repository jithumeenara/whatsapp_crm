import { NextRequest, NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") ?? "all";
    const search = searchParams.get("search") ?? "";
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Number(searchParams.get("pageSize") ?? "48"));

    const where = {
      account_id: ctx.accountId,
      ...(category !== "all" ? { file_category: category } : {}),
      ...(search ? { original_name: { contains: search, mode: "insensitive" as const } } : {}),
    };

    const [files, total, storageAgg] = await Promise.all([
      prisma.fileUpload.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.fileUpload.count({ where }),
      prisma.fileUpload.aggregate({
        where: { account_id: ctx.accountId },
        _sum: { size: true },
        _count: { id: true },
      }),
    ]);

    return NextResponse.json({
      files,
      total,
      page,
      pageSize,
      storage: {
        used: storageAgg._sum.size ?? 0,
        fileCount: storageAgg._count.id,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

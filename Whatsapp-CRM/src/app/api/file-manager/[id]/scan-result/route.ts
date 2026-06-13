import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Virus scan webhook — called by external scanner after scanning a file.
// Body: { status: "clean" | "infected", result?: object }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const status = body.status === "infected" ? "infected" : "clean";

    const file = await prisma.fileUpload.findUnique({ where: { id } });
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.fileUpload.update({
      where: { id },
      data: {
        scan_status: status,
        scan_result: body.result ?? null,
      },
    });

    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

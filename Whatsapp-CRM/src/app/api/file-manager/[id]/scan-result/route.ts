import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validScanSignature } from "@/lib/files/scan-signature";

// Virus scan webhook — called by the external scanner after scanning a file,
// at the callback URL it was given (scanCallbackUrl), which carries a
// signature of the file id. Nothing else may set a file's scan result.
// Body: { status: "clean" | "infected", result?: object }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validScanSignature(id, req.nextUrl.searchParams.get("sig"))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = (await req.json().catch(() => ({}))) as { status?: unknown; result?: unknown };
    const status = body.status === "infected" ? "infected" : "clean";

    const file = await prisma.fileUpload.findUnique({ where: { id }, select: { id: true } });
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.fileUpload.update({
      where: { id },
      data: {
        scan_status: status,
        // Kept small: it is the scanner's note, not a place to store anything.
        scan_result: body.result && typeof body.result === "object" && JSON.stringify(body.result).length <= 4000 ? (body.result as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    console.error("[scan-result]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

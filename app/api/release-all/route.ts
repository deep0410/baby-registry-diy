import { NextRequest, NextResponse } from "next/server";
import { release } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Batch-release multiple holds in one request.
// Used by the client's beforeunload/pagehide sendBeacon so a single
// network call frees every held item when the page is closed or refreshed.
export async function POST(req: NextRequest) {
  try {
    const { items, session } = await req.json();
    if (!Array.isArray(items) || !session) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    await Promise.all(
      items.map(({ id, slot }: { id: string; slot: number }) =>
        release(String(id), Number(slot), String(session)).catch(() => {
          /* ignore – hold may already be gone */
        })
      )
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

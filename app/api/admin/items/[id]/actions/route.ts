import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { adminClearAll, adminMarkPurchased, adminRemoveSlot } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Body: { action: "markPurchased" | "removeSlot" | "clearAll", slot?: number }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { action, slot } = await req.json();
    if (action === "markPurchased") {
      const ok = await adminMarkPurchased(params.id);
      return NextResponse.json({ ok, reason: ok ? undefined : "nothing_available" });
    }
    if (action === "removeSlot") {
      if (slot === undefined) return NextResponse.json({ error: "Missing slot" }, { status: 400 });
      await adminRemoveSlot(params.id, Number(slot));
      return NextResponse.json({ ok: true });
    }
    if (action === "clearAll") {
      await adminClearAll(params.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

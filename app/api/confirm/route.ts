import { NextRequest, NextResponse } from "next/server";
import { confirm } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Body: { session, name, message, items: [{ id, slot, purchasedFrom? }] }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { session, name, message } = body;
    const items: Array<{ id: string; slot: number; purchasedFrom?: string }> = body.items || [];
    if (!session || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Please enter your name" }, { status: 400 });
    }

    const confirmed: string[] = [];
    const failed: string[] = [];
    for (const it of items) {
      const ok = await confirm(
        String(it.id),
        Number(it.slot),
        String(session),
        String(name),
        String(message || ""),
        String(it.purchasedFrom || "")
      );
      if (ok) confirmed.push(it.id);
      else failed.push(it.id);
    }
    return NextResponse.json({ ok: failed.length === 0, confirmed, failed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

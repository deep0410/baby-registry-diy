import { NextRequest, NextResponse } from "next/server";
import { reserve } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { id, session } = await req.json();
    if (!id || !session) {
      return NextResponse.json({ error: "Missing id or session" }, { status: 400 });
    }
    const result = await reserve(String(id), String(session));
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason || "unavailable" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, slot: result.slot });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { release } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { id, slot, session } = await req.json();
    if (!id || slot === undefined || !session) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    await release(String(id), Number(slot), String(session));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

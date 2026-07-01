import { NextRequest, NextResponse } from "next/server";
import { checkHolds } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Validates which holds in the client's tray are still active in DynamoDB.
// Returns only the holds that are still live — caller removes the rest from the tray.
export async function POST(req: NextRequest) {
  try {
    const { items, session } = await req.json();
    if (!Array.isArray(items) || !session) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const valid = await checkHolds(
      items.map(({ id, slot }: { id: string; slot: number }) => ({ id: String(id), slot: Number(slot) })),
      String(session)
    );
    return NextResponse.json({ valid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

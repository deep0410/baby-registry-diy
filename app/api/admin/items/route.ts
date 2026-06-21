import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { createItem, getAdminItems } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await getAdminItems();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.name || !String(body.name).trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const id = await createItem({
      name: String(body.name),
      url: String(body.url || ""),
      imageUrl: body.imageUrl ? String(body.imageUrl) : undefined,
      imageKey: body.imageKey ? String(body.imageKey) : undefined,
      price: body.price !== undefined ? String(body.price) : undefined,
      quantity: Number(body.quantity || 1),
    });
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

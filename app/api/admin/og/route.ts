import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { fetchProductInfo } from "@/lib/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
    const info = await fetchProductInfo(String(url));
    return NextResponse.json(info); // { imageUrl, price, title }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

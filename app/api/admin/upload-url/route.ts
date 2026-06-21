import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { presignUpload } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { contentType } = await req.json();
    if (!contentType) return NextResponse.json({ error: "Missing contentType" }, { status: 400 });
    const { url, key } = await presignUpload(String(contentType));
    return NextResponse.json({ url, key });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 400 });
  }
}

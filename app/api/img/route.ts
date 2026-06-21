import { NextRequest, NextResponse } from "next/server";
import { presignGet } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve a private-bucket image by redirecting to a short-lived presigned URL.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  try {
    const url = await presignGet(key);
    return NextResponse.redirect(url, 302);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!checkCredentials(String(username || ""), String(password || ""))) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }
    setSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

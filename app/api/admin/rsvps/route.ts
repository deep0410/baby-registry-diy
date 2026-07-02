import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { listRsvps } from "@/lib/rsvp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rsvps = await listRsvps();
  return NextResponse.json({ rsvps });
}

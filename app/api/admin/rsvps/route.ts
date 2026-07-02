import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import {
  deleteRsvp,
  getRsvp,
  listRsvps,
  normalizeEmail,
  saveRsvp,
  updateRsvp,
} from "@/lib/rsvp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body: any): { name: string; email: string; partySize: number } | string {
  const name = String(body.name || "").trim();
  const email = normalizeEmail(String(body.email || ""));
  const partySize = Math.floor(Number(body.partySize));
  if (!name) return "Name is required";
  if (!EMAIL_RE.test(email)) return "A valid email is required";
  if (!Number.isFinite(partySize) || partySize < 1 || partySize > 50)
    return "Number of people must be between 1 and 50";
  return { name, email, partySize };
}

export async function GET() {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rsvps = await listRsvps();
  return NextResponse.json({ rsvps });
}

// Add an RSVP manually (no confirmation email — admin action).
export async function POST(req: NextRequest) {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const v = validate(await req.json());
    if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
    const existing = await getRsvp(v.email);
    if (existing)
      return NextResponse.json(
        { error: "An RSVP with that email already exists" },
        { status: 409 }
      );
    const { rsvp } = await saveRsvp(v);
    return NextResponse.json({ ok: true, rsvp });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

// Edit an RSVP (name, email, or party size). No confirmation email.
export async function PATCH(req: NextRequest) {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const originalEmail = normalizeEmail(String(body.originalEmail || ""));
    if (!EMAIL_RE.test(originalEmail))
      return NextResponse.json({ error: "originalEmail is required" }, { status: 400 });
    const v = validate(body);
    if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
    const result = await updateRsvp({ originalEmail, ...v });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, rsvp: result.rsvp });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

// Remove an RSVP.
export async function DELETE(req: NextRequest) {
  if (!isAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const email = normalizeEmail(req.nextUrl.searchParams.get("email") || "");
    if (!EMAIL_RE.test(email))
      return NextResponse.json({ error: "email query param is required" }, { status: 400 });
    await deleteRsvp(email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

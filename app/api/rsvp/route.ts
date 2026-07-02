import { NextRequest, NextResponse } from "next/server";
import { getRsvp, saveRsvp, normalizeEmail } from "@/lib/rsvp";
import { sendRsvpEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/rsvp?email=... — look up an existing RSVP
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") || "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const rsvp = await getRsvp(email);
  return NextResponse.json({ rsvp });
}

// POST /api/rsvp — create or update an RSVP.
// If the email already has an RSVP and `confirmUpdate` isn't set, we don't
// overwrite — we return the existing record so the UI can show the
// "you've already RSVP'd" flow.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const email = normalizeEmail(String(body.email || ""));
    const partySize = Math.floor(Number(body.partySize));
    const confirmUpdate = !!body.confirmUpdate;

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!EMAIL_RE.test(email))
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    if (!Number.isFinite(partySize) || partySize < 1 || partySize > 50)
      return NextResponse.json(
        { error: "Number of people must be between 1 and 50" },
        { status: 400 }
      );

    const existing = await getRsvp(email);
    if (existing && !confirmUpdate) {
      return NextResponse.json({ ok: false, exists: true, rsvp: existing }, { status: 409 });
    }

    const { rsvp, created } = await saveRsvp({ name, email, partySize });

    // Confirmation email — an email failure shouldn't lose the RSVP.
    let emailSent = true;
    try {
      await sendRsvpEmail({ name: rsvp.name, email, partySize, isUpdate: !created });
    } catch (e) {
      emailSent = false;
      console.error("RSVP email failed:", e);
    }

    return NextResponse.json({ ok: true, created, rsvp, emailSent });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

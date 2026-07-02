import nodemailer from "nodemailer";

// Sends RSVP confirmation emails from a personal Gmail account.
// Requires GMAIL_USER + GMAIL_APP_PASSWORD (create one at
// https://myaccount.google.com/apppasswords — regular password won't work).

function eventDetails() {
  return {
    eventName: process.env.EVENT_NAME || "Baby Shower",
    venueName: process.env.VENUE_NAME || "",
    venueAddress: process.env.VENUE_ADDRESS || "",
    eventTime: process.env.EVENT_TIME || "",
    attireMen: process.env.ATTIRE_MEN || "",
    attireWomen: process.env.ATTIRE_WOMEN || "",
  };
}

function transporter() {
  const user = process.env.GMAIL_USER || "";
  const pass = process.env.GMAIL_APP_PASSWORD || "";
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Returns true if the email was actually sent, false if skipped (creds not set).
// Throws on a real send failure (e.g. bad app password).
export async function sendRsvpEmail(opts: {
  name: string;
  email: string;
  partySize: number;
  isUpdate: boolean;
}): Promise<boolean> {
  const t = transporter();
  if (!t) {
    console.warn("RSVP email skipped: GMAIL_USER / GMAIL_APP_PASSWORD not set");
    return false;
  }
  const d = eventDetails();
  const firstName = opts.name.trim().split(/\s+/)[0] || opts.name;
  const guests = `${opts.partySize} ${opts.partySize === 1 ? "person" : "people"}`;

  const subject = opts.isUpdate
    ? `Your RSVP has been updated — ${d.eventName}`
    : `You're on the list! — ${d.eventName}`;

  const detailRows: Array<[string, string]> = [];
  if (d.venueName) detailRows.push(["Venue", d.venueName]);
  if (d.venueAddress) detailRows.push(["Address", d.venueAddress]);
  if (d.eventTime) detailRows.push(["When", d.eventTime]);
  if (d.attireMen) detailRows.push(["Attire (men)", d.attireMen]);
  if (d.attireWomen) detailRows.push(["Attire (women)", d.attireWomen]);

  const textDetails = detailRows.map(([k, v]) => `${k}: ${v}`).join("\n");
  const text = [
    `Hi ${firstName},`,
    "",
    opts.isUpdate
      ? `Your RSVP for ${d.eventName} has been updated. We now have you down for ${guests}.`
      : `Thanks for RSVPing to ${d.eventName}! We have you down for ${guests}.`,
    "",
    textDetails,
    "",
    `Need to make a change? Just RSVP again with the same email address.`,
    "",
    `See you there!`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const htmlDetails = detailRows
    .map(
      ([k, v]) => `
        <tr>
          <td style="padding:8px 16px 8px 0;font-weight:700;color:#8c847c;font-size:13px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td>
          <td style="padding:8px 0;color:#3f3a36;font-size:15px;">${escapeHtml(v)}</td>
        </tr>`
    )
    .join("");

  const html = `
  <div style="background:#faf6f1;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:#3f3a36;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ece4db;border-radius:18px;padding:32px;">
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:600;">${escapeHtml(d.eventName)}</h1>
      <p style="margin:0 0 20px;color:#b97f7f;font-size:14px;letter-spacing:.1em;text-transform:uppercase;">
        ${opts.isUpdate ? "RSVP updated" : "RSVP confirmed"}
      </p>
      <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:15px;line-height:1.6;">
        ${
          opts.isUpdate
            ? `Your RSVP has been updated — we now have you down for <strong>${guests}</strong>.`
            : `Thanks for RSVPing! We have you down for <strong>${guests}</strong>.`
        }
      </p>
      ${
        detailRows.length
          ? `<table style="width:100%;border-collapse:collapse;margin:20px 0;border-top:1px solid #ece4db;border-bottom:1px solid #ece4db;">${htmlDetails}</table>`
          : ""
      }
      <p style="font-size:13px;color:#8c847c;line-height:1.6;">
        Need to make a change? Just RSVP again with the same email address.
      </p>
      <p style="font-size:15px;">See you there! 💛</p>
    </div>
  </div>`;

  await t.sendMail({
    from: `"${d.eventName}" <${process.env.GMAIL_USER}>`,
    to: opts.email,
    subject,
    text,
    html,
  });
  return true;
}

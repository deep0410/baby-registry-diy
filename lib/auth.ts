import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE = "admin_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

// Token format: "<issuedAtSeconds>.<hmac>"
function makeToken(): string {
  const issued = Math.floor(Date.now() / 1000).toString();
  return `${issued}.${sign(issued)}`;
}

function validToken(token: string | undefined): boolean {
  if (!token) return false;
  const [issued, sig] = token.split(".");
  if (!issued || !sig) return false;
  const expected = sign(issued);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = Math.floor(Date.now() / 1000) - parseInt(issued, 10);
  return age >= 0 && age < MAX_AGE;
}

export function checkCredentials(username: string, password: string): boolean {
  const u = process.env.ADMIN_USERNAME || "";
  const p = process.env.ADMIN_PASSWORD || "";
  // constant-ish time compare
  const okU = u.length === username.length && timingSafeEqual(Buffer.from(u), Buffer.from(username));
  const okP = p.length === password.length && timingSafeEqual(Buffer.from(p), Buffer.from(password));
  return okU && okP;
}

export function setSessionCookie(): void {
  cookies().set(COOKIE, makeToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie(): void {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function isAuthed(): boolean {
  return validToken(cookies().get(COOKIE)?.value);
}

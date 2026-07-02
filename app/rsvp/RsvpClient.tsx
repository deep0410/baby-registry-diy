"use client";

import { useState } from "react";
import Link from "next/link";
import type { Rsvp } from "@/lib/rsvp";

type Phase = "form" | "exists" | "editing" | "done";

export default function RsvpClient({
  title,
  eventName,
}: {
  title: string;
  eventName: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [partySize, setPartySize] = useState("1");
  const [phase, setPhase] = useState<Phase>("form");
  const [existing, setExisting] = useState<Rsvp | null>(null);
  const [result, setResult] = useState<{ created: boolean; emailSent: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (confirmUpdate: boolean) => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          partySize: Number(partySize),
          confirmUpdate,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.exists) {
        // Already RSVP'd — show their existing RSVP + offer to change it.
        setExisting(data.rsvp);
        setName(data.rsvp.name);
        setPartySize(String(data.rsvp.partySize));
        setPhase("exists");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setResult({ created: data.created, emailSent: data.emailSent });
      setPhase("done");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(phase === "editing");
  };

  const resetAll = () => {
    setName("");
    setEmail("");
    setPartySize("1");
    setExisting(null);
    setResult(null);
    setError("");
    setPhase("form");
  };

  return (
    <main>
      <header className="site-header">
        <div className="eyebrow">{eventName}</div>
        <h1>{title}</h1>
        <p>We can&apos;t wait to celebrate with you 💛</p>
      </header>

      <div className="rsvp-wrap">
        <Link href="/" className="rsvp-back">← Back to home</Link>

        <div className="rsvp-card">
          {phase === "exists" && existing ? (
            <>
              <div className="rsvp-msg info">
                <strong>You&apos;ve already RSVP&apos;d!</strong>
                <br />
                {existing.name}, we have you down for{" "}
                <strong>
                  {existing.partySize} {existing.partySize === 1 ? "person" : "people"}
                </strong>
                .
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn block" onClick={() => setPhase("editing")}>
                  Change my RSVP
                </button>
                <button className="btn ghost block" onClick={resetAll}>
                  Done
                </button>
              </div>
            </>
          ) : phase === "done" && result ? (
            <>
              <div className="rsvp-msg ok">
                <strong>
                  {result.created ? "You're on the list! 🎉" : "Your RSVP has been updated! ✅"}
                </strong>
                <br />
                {name}, we have you down for{" "}
                <strong>
                  {Number(partySize)} {Number(partySize) === 1 ? "person" : "people"}
                </strong>
                .
                <br />
                {result.emailSent
                  ? "A confirmation email with all the event details is on its way."
                  : "We couldn't send the confirmation email, but your RSVP is saved."}
              </div>
              <Link href="/baby-registry" className="btn block sage" style={{ textAlign: "center", textDecoration: "none", display: "block", marginBottom: 10 }}>
                Browse the baby registry →
              </Link>
              <button className="btn ghost block" onClick={resetAll}>
                RSVP for someone else
              </button>
            </>
          ) : (
            <form onSubmit={onSubmit}>
              {phase === "editing" && existing && (
                <div className="rsvp-msg info">
                  Updating the RSVP for <strong>{existing.email}</strong>
                </div>
              )}
              {error && <div className="rsvp-msg err">{error}</div>}

              <label htmlFor="rsvp-name">Your name</label>
              <input
                id="rsvp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
                autoComplete="name"
              />

              <label htmlFor="rsvp-email">Email address</label>
              <input
                id="rsvp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                disabled={phase === "editing"}
              />

              <label htmlFor="rsvp-party">Number of people (including you)</label>
              <input
                id="rsvp-party"
                type="number"
                min={1}
                max={50}
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
                required
              />

              <div style={{ marginTop: 22, display: "flex", gap: 10 }}>
                <button className="btn block" type="submit" disabled={busy}>
                  {busy ? "Saving…" : phase === "editing" ? "Save changes" : "Submit RSVP"}
                </button>
                {phase === "editing" && (
                  <button className="btn ghost block" type="button" onClick={resetAll} disabled={busy}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

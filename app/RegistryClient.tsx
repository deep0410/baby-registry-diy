"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicItem } from "@/lib/types";

interface TrayEntry {
  id: string;
  slot: number;
  name: string;
  imageUrl: string;
  url: string;
}

export default function RegistryClient({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const [items, setItems] = useState<PublicItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tray, setTray] = useState<TrayEntry[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const session = useRef<string>("");

  // Stable session id for hold ownership.
  useEffect(() => {
    let s = "";
    try {
      s = localStorage.getItem("registry_session") || "";
      if (!s) {
        s = crypto.randomUUID();
        localStorage.setItem("registry_session", s);
      }
    } catch {
      s = Math.random().toString(36).slice(2);
    }
    session.current = s;
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/items", { cache: "no-store" });
      const data = await res.json();
      if (data.items) setItems(data.items);
    } catch {
      /* ignore transient errors */
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + background refresh.
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const inTray = (id: string) => tray.some((t) => t.id === id);

  const addToGifts = async (item: PublicItem) => {
    if (inTray(item.id) || busyId) return;
    setBusyId(item.id);
    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, session: session.current }),
      });
      if (res.status === 409) {
        flash("Oh no — someone just grabbed the last one!");
        await load();
        return;
      }
      const data = await res.json();
      if (data.ok && data.slot !== undefined) {
        setTray((prev) => [
          ...prev,
          { id: item.id, slot: data.slot, name: item.name, imageUrl: item.imageUrl, url: item.url },
        ]);
        flash(`Added “${item.name}” to your gifts`);
        load();
      } else {
        flash("Couldn’t reserve that item. Please try again.");
        load();
      }
    } catch {
      flash("Network hiccup — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const removeFromGifts = async (entry: TrayEntry) => {
    setTray((prev) => prev.filter((t) => !(t.id === entry.id && t.slot === entry.slot)));
    try {
      await fetch("/api/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, slot: entry.slot, session: session.current }),
      });
    } catch {
      /* hold will expire on its own */
    }
    load();
  };

  const submit = async () => {
    if (!name.trim()) {
      flash("Please add your name so they know who to thank!");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: session.current,
          name,
          message,
          items: tray.map((t) => ({ id: t.id, slot: t.slot })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDone(true);
        setTray([]);
        setCheckoutOpen(false);
        setDrawerOpen(false);
        load();
      } else if (Array.isArray(data.confirmed)) {
        const confirmed = new Set(data.confirmed);
        setTray((prev) => prev.filter((t) => !confirmed.has(t.id)));
        flash("Some items were just taken by someone else. The rest are confirmed!");
        load();
      } else {
        flash(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      flash("Network hiccup — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <header className="site-header">
        <div className="eyebrow">Baby Registry</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <p className="note">
          Thank you for celebrating with us. Add the gifts you’d like to give to your list,
          then confirm — we’ll keep track so nothing is doubled up.
        </p>
      </header>

      {/* Floating gift tray button */}
      {tray.length > 0 && (
        <button className="tray-fab" onClick={() => setDrawerOpen(true)}>
          My Gifts <span className="count">{tray.length}</span>
        </button>
      )}

      {loading ? (
        <div className="empty">Loading the registry…</div>
      ) : items.length === 0 ? (
        <div className="empty">No items have been added yet. Check back soon! 🍼</div>
      ) : (
        <div className="grid">
          {items.map((item) => {
            const selected = inTray(item.id);
            const unavailable = item.soldOut && !selected;
            return (
              <div
                key={item.id}
                className={`card ${unavailable ? "taken" : ""} ${selected ? "selected" : ""}`}
              >
                <div className="thumb">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={item.name} loading="lazy" />
                  ) : (
                    <span className="placeholder">🎁</span>
                  )}
                  {item.soldOut ? (
                    <span className="badge sold">Reserved</span>
                  ) : item.quantity > 1 ? (
                    <span className="badge">
                      {item.remaining} of {item.quantity} left
                    </span>
                  ) : null}
                </div>
                <div className="card-body">
                  <div className="card-title">{item.name}</div>
                  {item.url ? (
                    <a className="link-out" href={item.url} target="_blank" rel="noreferrer">
                      View item ↗
                    </a>
                  ) : (
                    <span className="card-meta">&nbsp;</span>
                  )}
                  <div className="card-actions">
                    {selected ? (
                      <button className="btn ghost small block" disabled>
                        ✓ In your gifts
                      </button>
                    ) : unavailable ? (
                      <button className="btn ghost small block" disabled>
                        Already reserved
                      </button>
                    ) : (
                      <button
                        className="btn small block"
                        disabled={busyId === item.id}
                        onClick={() => addToGifts(item)}
                      >
                        {busyId === item.id ? "Adding…" : "I’ll gift this"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Gift tray drawer */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <h2>My Gifts</h2>
            {tray.length === 0 ? (
              <p className="muted">Your gift list is empty.</p>
            ) : (
              <>
                {tray.map((t) => (
                  <div className="tray-item" key={`${t.id}-${t.slot}`}>
                    {t.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="ti-thumb" src={t.imageUrl} alt={t.name} />
                    ) : (
                      <div className="ti-thumb" />
                    )}
                    <div className="ti-name">{t.name}</div>
                    <button className="ti-remove" onClick={() => removeFromGifts(t)}>
                      Remove
                    </button>
                  </div>
                ))}
                <p className="muted" style={{ marginTop: 16 }}>
                  These are held for you while you finish. Confirm to let the family know.
                </p>
                <button
                  className="btn block"
                  style={{ marginTop: 16 }}
                  onClick={() => {
                    setDrawerOpen(false);
                    setCheckoutOpen(true);
                  }}
                >
                  Confirm {tray.length} {tray.length === 1 ? "gift" : "gifts"}
                </button>
                <button
                  className="btn ghost block"
                  style={{ marginTop: 8 }}
                  onClick={() => setDrawerOpen(false)}
                >
                  Keep browsing
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkoutOpen && (
        <div className="overlay modal-center" onClick={() => setCheckoutOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Almost done 💝</h2>
            <p className="muted">
              You’re gifting {tray.length} {tray.length === 1 ? "item" : "items"}. Leave your
              name and a note for the family.
            </p>
            <label>Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aunt Priya" />
            <label>Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Can’t wait to meet the little one!"
            />
            <button
              className="btn block"
              style={{ marginTop: 18 }}
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? "Confirming…" : "Confirm my gifts"}
            </button>
            <button
              className="btn ghost block"
              style={{ marginTop: 8 }}
              onClick={() => {
                setCheckoutOpen(false);
                setDrawerOpen(true);
              }}
            >
              Back
            </button>
            <p className="muted center" style={{ marginTop: 14, fontSize: 12 }}>
              Remember to actually purchase the item from the store link. This list just
              prevents duplicate gifts.
            </p>
          </div>
        </div>
      )}

      {/* Thank-you modal */}
      {done && (
        <div className="overlay modal-center" onClick={() => setDone(false)}>
          <div className="modal center" onClick={(e) => e.stopPropagation()}>
            <h2>Thank you! 🤍</h2>
            <p className="muted">
              Your gifts are confirmed. The family will be so grateful. Don’t forget to
              complete your purchase from the store links!
            </p>
            <button className="btn block" style={{ marginTop: 16 }} onClick={() => setDone(false)}>
              Back to registry
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

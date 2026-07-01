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
  taxMultiplier = 1.13,
  houseAddress = "",
}: {
  title: string;
  subtitle: string;
  taxMultiplier?: number;
  houseAddress?: string;
}) {
  const showTax = Math.abs(taxMultiplier - 1) > 0.001;
  // Apply the tax multiplier to a display price like "$129.99" / "CA$49.99".
  const withTax = (price: string): string => {
    if (!price) return "";
    const m = price.match(/^([^\d]*)([\d.,]+)(.*)$/);
    if (!m) return price;
    const num = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(num)) return price;
    return `${m[1]}${(num * taxMultiplier).toFixed(2)}`;
  };
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
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [selectedRetailers, setSelectedRetailers] = useState<Set<string>>(new Set());
  const session = useRef<string>("");

  // Restore session + tray from localStorage so holds survive a refresh or tab close.
  useEffect(() => {
    let s = "";
    try {
      s = localStorage.getItem("registry_session") || "";
      if (!s) {
        s = crypto.randomUUID();
        localStorage.setItem("registry_session", s);
      }
      const saved = localStorage.getItem("registry_tray");
      if (saved) setTray(JSON.parse(saved));
    } catch {
      s = Math.random().toString(36).slice(2);
    }
    session.current = s;
  }, []);

  // Keep tray in sync with localStorage on every change.
  useEffect(() => {
    try {
      if (tray.length > 0) {
        localStorage.setItem("registry_tray", JSON.stringify(tray));
      } else {
        localStorage.removeItem("registry_tray");
      }
    } catch {}
  }, [tray]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  // Detect the retailer name + domain from a product URL for favicon + filtering.
  function getRetailer(url: string): { name: string; domain: string } | null {
    if (!url) return null;
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host.includes("amazon."))   return { name: "Amazon",       domain: host };
      if (host.includes("walmart."))  return { name: "Walmart",      domain: host };
      if (host.includes("ikea."))     return { name: "IKEA",         domain: host };
      if (host.includes("target."))   return { name: "Target",       domain: host };
      if (host.includes("bestbuy."))  return { name: "Best Buy",     domain: host };
      if (host.includes("costco."))   return { name: "Costco",       domain: host };
      if (host.includes("toysrus.") || host.includes("babiesrus.")) return { name: "Babies R Us", domain: host };
      if (host.includes("chapters.") || host.includes("indigo."))   return { name: "Indigo",      domain: host };
      return { name: host, domain: host };
    } catch { return null; }
  }

  const lastHoldCheck = useRef(0);

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

    // Validate tray holds every 15 seconds.
    const now = Date.now();
    if (now - lastHoldCheck.current < 15000) return;
    lastHoldCheck.current = now;

    setTray((currentTray) => {
      if (currentTray.length === 0 || !session.current) return currentTray;
      fetch("/api/check-holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: currentTray.map((e) => ({ id: e.id, slot: e.slot })),
          session: session.current,
        }),
      })
        .then((r) => r.json())
        .then(({ valid }) => {
          if (!Array.isArray(valid)) return;
          const validKeys = new Set(
            valid.map((v: { id: string; slot: number }) => `${v.id}:${v.slot}`),
          );
          setTray((t) => t.filter((e) => validKeys.has(`${e.id}:${e.slot}`)));
        })
        .catch(() => {
          /* ignore transient errors */
        });
      return currentTray;
    });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
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
          {
            id: item.id,
            slot: data.slot,
            name: item.name,
            imageUrl: item.imageUrl,
            url: item.url,
          },
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
    setTray((prev) =>
      prev.filter((t) => !(t.id === entry.id && t.slot === entry.slot)),
    );
    try {
      await fetch("/api/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.id,
          slot: entry.slot,
          session: session.current,
        }),
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
        setTray([]); // also clears localStorage via the tray useEffect
        setCheckoutOpen(false);
        setDrawerOpen(false);
        load();
      } else if (Array.isArray(data.confirmed)) {
        const confirmed = new Set(data.confirmed);
        setTray((prev) => prev.filter((t) => !confirmed.has(t.id)));
        flash(
          "Some items were just taken by someone else. The rest are confirmed!",
        );
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
          Thank you for celebrating with us. Add the gifts you’d like to give to
          your list, then confirm — we’ll keep track so nothing is doubled up.
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
        <div className="empty">
          No items have been added yet. Check back soon! 🍼
        </div>
      ) : (() => {
        // Unique retailers present in the list (only items with URLs)
        const retailerMap = new Map<string, string>(); // name → domain
        items.forEach((item) => {
          const r = getRetailer(item.url);
          if (r && !retailerMap.has(r.name)) retailerMap.set(r.name, r.domain);
        });
        const retailers = Array.from(retailerMap.entries()); // [[name, domain], …]

        const filteredItems =
          selectedRetailers.size === 0
            ? items
            : items.filter((item) => {
                const r = getRetailer(item.url);
                return r && selectedRetailers.has(r.name);
              });

        return (
          <>
            {/* ── Retailer filter chips ── */}
            {retailers.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                <button
                  className={`btn small${selectedRetailers.size === 0 ? "" : " ghost"}`}
                  onClick={() => setSelectedRetailers(new Set())}
                >
                  All
                </button>
                {retailers.map(([name, domain]) => (
                  <button
                    key={name}
                    className={`btn small${selectedRetailers.has(name) ? "" : " ghost"}`}
                    onClick={() =>
                      setSelectedRetailers((prev) => {
                        const next = new Set(prev);
                        if (next.has(name)) next.delete(name);
                        else next.add(name);
                        return next;
                      })
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                      alt=""
                      width={14}
                      height={14}
                      style={{ marginRight: 5, verticalAlign: "middle", borderRadius: 3 }}
                    />
                    {name}
                  </button>
                ))}
              </div>
            )}

            {/* ── Item grid ── */}
            <div className="grid">
              {filteredItems.map((item) => {
                const selected = inTray(item.id);
                const unavailable = item.soldOut && !selected;
                const retailer = getRetailer(item.url);
                return (
                  <div
                    key={item.id}
                    className={`card ${unavailable ? "taken" : ""} ${selected ? "selected" : ""}`}
                  >
                    <div className="thumb" style={{ position: "relative" }}>
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
                      {/* Retailer favicon badge */}
                      {retailer && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${retailer.domain}&sz=32`}
                          alt={retailer.name}
                          title={retailer.name}
                          width={20}
                          height={20}
                          style={{
                            position: "absolute",
                            bottom: 6,
                            right: 6,
                            borderRadius: 5,
                            background: "white",
                            padding: 2,
                            boxShadow: "0 1px 4px rgba(0,0,0,.18)",
                          }}
                        />
                      )}
                    </div>
                    <div className="card-body">
                      <div
                        className="card-title"
                        style={{
                          fontSize: "0.82rem",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          lineHeight: 1.35,
                          minHeight: "2.2em",
                        }}
                      >
                        {item.name}
                      </div>
                      <div className="card-price-row">
                        {item.price ? (
                          <span className="price">
                            {withTax(item.price)}
                            {showTax && <span className="tax-note">incl. tax</span>}
                          </span>
                        ) : (
                          <span />
                        )}
                        {item.url && (
                          <a
                            className="link-out"
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View ↗
                          </a>
                        )}
                      </div>
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
          </>
        );
      })()}

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
                    <button
                      className="ti-remove"
                      onClick={() => removeFromGifts(t)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <p className="muted" style={{ marginTop: 16 }}>
                  These are held for you while you finish. Confirm to let the
                  family know.
                </p>
                <button
                  className="btn block"
                  style={{ marginTop: 16 }}
                  onClick={() => {
                    setDrawerOpen(false);
                    setDeliveryOpen(true);
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

      {/* Delivery instructions modal */}
      {deliveryOpen && (
        <div className="overlay modal-center" onClick={() => setDeliveryOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>How to deliver your gift 📦</h2>
            <p className="muted">
              Before confirming, here’s how to get the item to us:
            </p>

            {houseAddress && (
              <div
                style={{
                  background: "var(--bg-card, #fdf6f0)",
                  border: "1.5px solid var(--border)",
                  borderRadius: 10,
                  padding: "12px 16px",
                  margin: "14px 0",
                  fontWeight: 700,
                  fontSize: "1rem",
                  lineHeight: 1.5,
                  letterSpacing: "0.01em",
                }}
              >
                📍 {houseAddress}
              </div>
            )}

            <ol style={{ paddingLeft: 20, margin: "10px 0 18px", lineHeight: 1.85, fontSize: 14 }}>
              <li>Click <strong>View item ↗</strong> on any card to open the store page.</li>
              <li>Add the item to your cart and proceed to checkout.</li>
              <li>
                Enter the <strong>address above</strong> as the shipping address —
                most stores ship directly to a gift recipient.
              </li>
              <li>
                If you’re local and prefer a drop-off, reach out to arrange a time
                before ordering.
              </li>
            </ol>

            <button
              className="btn block"
              style={{ marginTop: 4 }}
              onClick={() => { setDeliveryOpen(false); setCheckoutOpen(true); }}
            >
              Got it — who should we thank? →
            </button>
            <button
              className="btn ghost block"
              style={{ marginTop: 8 }}
              onClick={() => { setDeliveryOpen(false); setDrawerOpen(true); }}
            >
              Back to my gifts
            </button>
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkoutOpen && (
        <div
          className="overlay modal-center"
          onClick={() => setCheckoutOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Almost done 💝</h2>
            <p className="muted">
              You’re gifting {tray.length}{" "}
              {tray.length === 1 ? "item" : "items"}. Leave your name and a note
              for the family.
            </p>
            <label>Your name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aunt Priya"
            />
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
                setDeliveryOpen(true);
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Thank-you modal */}
      {done && (
        <div className="overlay modal-center" onClick={() => setDone(false)}>
          <div className="modal center" onClick={(e) => e.stopPropagation()}>
            <h2>Thank you! 🤍</h2>
            <p className="muted">
              Your gifts are confirmed. The family will be so grateful. Don’t
              forget to complete your purchase from the store links!
            </p>
            <button
              className="btn block"
              style={{ marginTop: 16 }}
              onClick={() => setDone(false)}
            >
              Back to registry
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

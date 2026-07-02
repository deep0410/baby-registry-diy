"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicItem } from "@/lib/types";

interface TrayEntry {
  id: string;
  slot: number;
  name: string;
  imageUrl: string;
  url: string;
  price: string;
  taxExempt: boolean;
}

// How long, in words, we tell the guest their items are held. This should match
// HOLD_TTL_SECONDS on the server (5400s = 1h30m).
const HOLD_LABEL = "1 hour and 30 minutes";

const STEP_LABELS: Record<number, string> = {
  1: "Select",
  2: "Reserve & buy",
  3: "Confirm",
};

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
  // Parse a display price like "$129.99" / "CA$49.99" into a currency prefix + amount.
  const parsePriceValue = (price: string): { prefix: string; num: number } | null => {
    if (!price) return null;
    const m = price.match(/^([^\d]*)([\d.,]+)/);
    if (!m) return null;
    const num = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(num)) return null;
    return { prefix: m[1], num };
  };
  // Apply the tax multiplier to a display price like "$129.99" / "CA$49.99".
  // Skipped for items marked tax-exempt.
  const withTax = (price: string, exempt = false): string => {
    const p = parsePriceValue(price);
    if (!p) return price || "";
    const mult = exempt ? 1 : taxMultiplier;
    return `${p.prefix}${(p.num * mult).toFixed(2)}`;
  };
  // Taxed numeric value of a display price, or 0 if unparsable.
  const taxedValue = (price: string, exempt = false): number => {
    const p = parsePriceValue(price);
    if (!p) return 0;
    return exempt ? p.num : p.num * taxMultiplier;
  };

  const [items, setItems] = useState<PublicItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tray, setTray] = useState<TrayEntry[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [selectedRetailers, setSelectedRetailers] = useState<Set<string>>(new Set());
  // Quantity picker modal for multi-unit items
  const [qtyModal, setQtyModal] = useState<{ item: PublicItem; qty: number } | null>(null);

  // Wizard state
  const [step, setStep] = useState(1); // 1 = select, 2 = reserve & buy, 3 = confirm
  const [showIntro, setShowIntro] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const session = useRef<string>("");

  // Restore session + tray (localStorage: survive tab close so holds persist),
  // and intro-seen + current step (sessionStorage: reset each new session, but
  // survive a refresh so we can drop the guest back where they were).
  useEffect(() => {
    let s = "";
    try {
      s = localStorage.getItem("registry_session") || "";
      if (!s) {
        s = crypto.randomUUID();
        localStorage.setItem("registry_session", s);
      }
      const saved = localStorage.getItem("registry_tray");
      const savedTray: TrayEntry[] = saved ? JSON.parse(saved) : [];
      if (savedTray.length) setTray(savedTray);

      const introSeen = sessionStorage.getItem("registry_intro_seen") === "1";
      setShowIntro(!introSeen);

      const savedStep = parseInt(sessionStorage.getItem("registry_step") || "1", 10);
      let restoredStep = savedStep === 2 || savedStep === 3 ? savedStep : 1;
      // Can't be on a review/confirm step with nothing held.
      if (restoredStep > 1 && savedTray.length === 0) restoredStep = 1;
      setStep(restoredStep);
    } catch {
      s = Math.random().toString(36).slice(2);
      setShowIntro(true);
    }
    session.current = s;
    setHydrated(true);
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

  // Persist the current step for this session so a refresh returns here.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem("registry_step", String(step));
    } catch {}
  }, [step, hydrated]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const dismissIntro = () => {
    try {
      sessionStorage.setItem("registry_intro_seen", "1");
    } catch {}
    setShowIntro(false);
  };

  const goToStep = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  // If holds expire out from under the guest while they're past step 1, bounce
  // them back so they can't confirm an empty list.
  useEffect(() => {
    if (hydrated && tray.length === 0 && step > 1 && !done) setStep(1);
  }, [tray.length, step, hydrated, done]);

  const inTray = (id: string) => tray.some((t) => t.id === id);

  // Running total across everything currently in the tray (tax included).
  const trayCurrency = tray.reduce<string>((prefix, t) => {
    if (prefix) return prefix;
    return parsePriceValue(t.price || "")?.prefix || "";
  }, "") || "$";
  const trayTotal = tray.reduce((sum, t) => sum + taxedValue(t.price || "", t.taxExempt), 0);
  const trayTotalLabel = `${trayCurrency}${trayTotal.toFixed(2)}`;

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
            price: item.price || "",
            taxExempt: !!item.taxExempt,
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

  // Reserve `count` units of one item (one API call per unit). Used by the
  // quantity picker for multi-unit items.
  const reserveMany = async (item: PublicItem, count: number) => {
    if (busyId) return;
    setQtyModal(null);
    setBusyId(item.id);
    let reserved = 0;
    try {
      for (let i = 0; i < count; i++) {
        const res = await fetch("/api/reserve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, session: session.current }),
        });
        if (res.status === 409) break; // no more units available
        const data = await res.json();
        if (data.ok && data.slot !== undefined) {
          const slot = data.slot as number;
          setTray((prev) => [
            ...prev,
            { id: item.id, slot, name: item.name, imageUrl: item.imageUrl, url: item.url, price: item.price || "", taxExempt: !!item.taxExempt },
          ]);
          reserved++;
        } else break;
      }
    } catch {
      /* fall through to messaging below */
    } finally {
      setBusyId(null);
    }
    if (reserved === count) {
      flash(`Added ${reserved} × “${item.name}” to your gifts`);
    } else if (reserved > 0) {
      flash(`Reserved ${reserved} of ${count} — the rest were just taken.`);
    } else {
      flash("Couldn’t reserve those — they may have just been taken.");
    }
    load();
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
        try {
          sessionStorage.setItem("registry_step", "1");
        } catch {}
        setStep(1);
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

  // ── Stepper ──
  const Stepper = () => (
    <div className="stepper">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className={`step-node ${step === n ? "active" : ""} ${step > n ? "done" : ""}`}
        >
          <span className="step-num">{step > n ? "✓" : n}</span>
          <span className="step-lbl">{STEP_LABELS[n]}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="container">
      <header className="site-header">
        <div className="eyebrow">Baby Registry</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>

      {!done && <Stepper />}

      {/* ─────────────── STEP 1 · Select ─────────────── */}
      {!done && step === 1 && (
        <>
          <p className="step-intro">
            <strong>Step 1.</strong> Tap “I’ll gift this” on everything you’d like
            to give. When you’re done, hit <strong>Next</strong>.
          </p>

          {loading ? (
            <div className="empty">Loading the registry…</div>
          ) : items.length === 0 ? (
            <div className="empty">
              No items have been added yet. Check back soon! 🍼
            </div>
          ) : (() => {
            // Hide items entirely once fully reserved/purchased by someone else —
            // don't just gray them out. Still show an item that's in the current
            // guest's own tray so they can review/remove their picks.
            const visibleItems = items.filter((item) => !item.soldOut || inTray(item.id));

            // Unique retailers present in the visible list (only items with URLs)
            const retailerMap = new Map<string, string>(); // name → domain
            visibleItems.forEach((item) => {
              const r = getRetailer(item.url);
              if (r && !retailerMap.has(r.name)) retailerMap.set(r.name, r.domain);
            });
            const retailers = Array.from(retailerMap.entries());

            const filteredItems =
              selectedRetailers.size === 0
                ? visibleItems
                : visibleItems.filter((item) => {
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
                    {retailers.map(([rname, domain]) => (
                      <button
                        key={rname}
                        className={`btn small${selectedRetailers.has(rname) ? "" : " ghost"}`}
                        onClick={() =>
                          setSelectedRetailers((prev) => {
                            const next = new Set(prev);
                            if (next.has(rname)) next.delete(rname);
                            else next.add(rname);
                            return next;
                          })
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                          alt=""
                          style={{ marginRight: 6, verticalAlign: "middle", borderRadius: 3, maxWidth: 32, maxHeight: 32, width: 20, height: 20 }}
                        />
                        {rname}
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
                          {selected && (
                            <button
                              className="select-remove"
                              aria-label="Remove from your gifts"
                              title="Remove"
                              onClick={() => removeFromGifts(tray.find((t) => t.id === item.id)!)}
                            >
                              ×
                            </button>
                          )}
                          {(() => {
                            const media = item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.imageUrl} alt={item.name} loading="lazy" />
                            ) : (
                              <span className="placeholder">🎁</span>
                            );
                            return item.url ? (
                              <a
                                className="thumb-link"
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`View ${item.name}`}
                              >
                                {media}
                              </a>
                            ) : (
                              media
                            );
                          })()}
                          {item.soldOut ? (
                            <span className="badge sold">Reserved</span>
                          ) : item.quantity > 1 ? (
                            <span className="badge">
                              {item.remaining} of {item.quantity} left
                            </span>
                          ) : null}
                          {retailer && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${retailer.domain}&sz=32`}
                              alt={retailer.name}
                              title={retailer.name}
                              style={{
                                position: "absolute",
                                bottom: 6,
                                right: 6,
                                borderRadius: 5,
                                background: "white",
                                padding: 2,
                                boxShadow: "0 1px 4px rgba(0,0,0,.18)",
                                maxWidth: 32,
                                maxHeight: 32,
                                width: 24,
                                height: 24,
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
                            {item.url ? (
                              <a className="title-link" href={item.url} target="_blank" rel="noreferrer">
                                {item.name}
                              </a>
                            ) : (
                              item.name
                            )}
                          </div>
                          <div className="card-price-row">
                            {item.price ? (
                              <span className="price">
                                {withTax(item.price, item.taxExempt)}
                                {showTax && !item.taxExempt && <span className="tax-note">incl. tax</span>}
                                {item.taxExempt && <span className="tax-note">no tax</span>}
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
                          <div className="card-actions" style={{ flexDirection: "column", gap: 6 }}>
                            {selected ? (
                              <>
                                <div className="selected-tag">✓ In your gifts</div>
                                <button
                                  className="btn outline small block"
                                  onClick={() => removeFromGifts(tray.find((t) => t.id === item.id)!)}
                                >
                                  Remove from list
                                </button>
                              </>
                            ) : unavailable ? (
                              <button className="btn ghost small block" disabled>
                                Already reserved
                              </button>
                            ) : (
                              <button
                                className="btn small block"
                                disabled={busyId === item.id}
                                onClick={() => {
                                  if (item.remaining > 1) {
                                    setQtyModal({ item, qty: 1 });
                                  } else {
                                    addToGifts(item);
                                  }
                                }}
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

          {/* Sticky action bar for step 1 */}
          <div className={`actionbar${tray.length > 0 ? " active" : ""}`}>
            <div className="ab-info">
              {tray.length === 0
                ? "No gifts selected yet"
                : `${tray.length} ${tray.length === 1 ? "gift" : "gifts"} selected (${trayTotalLabel})`}
            </div>
            <button
              className="btn"
              disabled={tray.length === 0}
              onClick={() => goToStep(2)}
            >
              Next →
            </button>
          </div>
        </>
      )}

      {/* ─────────────── STEP 2 · Reserve & buy ─────────────── */}
      {!done && step === 2 && (
        <div className="wizard">
          <div className="wizard-card">
            <div className="eyebrow">Step 2 of 3</div>
            <h2>We’re holding these for you 🤍</h2>
            <p className="muted">
              Your {tray.length} {tray.length === 1 ? "gift is" : "gifts are"}{" "}
              reserved so no one else can grab {tray.length === 1 ? "it" : "them"}.
              We’ll keep {tray.length === 1 ? "it" : "them"} held for{" "}
              <strong>{HOLD_LABEL}</strong> while you buy{" "}
              {tray.length === 1 ? "it" : "them"}.
            </p>

            {houseAddress && (
              <div className="address-box">
                <div className="address-label">Ship to this address</div>
                📍 {houseAddress}
              </div>
            )}

            <ol className="how-to">
              <li>Open each item at its store using the <strong>View ↗</strong> link below.</li>
              <li><strong>Add it to your cart on the provider’s website and check out on their website.</strong></li>
              <li>Enter the <strong>address above</strong> as the shipping address on the provider’s website.</li>
              <li>Once you’ve purchased everything, <strong>come back and hit Next.</strong></li>
            </ol>

            <div className="held-list">
              {tray.map((t) => (
                <div className="tray-item" key={`${t.id}-${t.slot}`}>
                  {(() => {
                    const thumb = t.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="ti-thumb" src={t.imageUrl} alt={t.name} />
                    ) : (
                      <div className="ti-thumb" />
                    );
                    return t.url ? (
                      <a
                        className="ti-thumb-link"
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${t.name}`}
                      >
                        {thumb}
                      </a>
                    ) : (
                      thumb
                    );
                  })()}
                  <div className="ti-info">
                    <div className="ti-name">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer">
                          {t.name}
                        </a>
                      ) : (
                        t.name
                      )}
                    </div>
                    {t.price && (
                      <div className="ti-price">
                        {withTax(t.price, t.taxExempt)}
                        {showTax && !t.taxExempt && <span className="tax-note"> incl. tax</span>}
                        {t.taxExempt && <span className="tax-note"> no tax</span>}
                      </div>
                    )}
                  </div>
                  <div className="ti-links">
                    {t.url && (
                      <a className="link-out" href={t.url} target="_blank" rel="noreferrer">
                        View ↗
                      </a>
                    )}
                    <button className="ti-remove" onClick={() => removeFromGifts(t)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {tray.some((t) => t.price) && (
                <div className="held-total">
                  <span>Total</span>
                  <span>{trayTotalLabel}</span>
                </div>
              )}
            </div>

            <button className="btn block" style={{ marginTop: 20 }} onClick={() => goToStep(3)}>
              I’ve purchased these — Next →
            </button>
            <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => goToStep(1)}>
              ← Back to selecting
            </button>
          </div>
        </div>
      )}

      {/* ─────────────── STEP 3 · Confirm ─────────────── */}
      {!done && step === 3 && (
        <div className="wizard">
          <div className="wizard-card">
            <div className="eyebrow">Step 3 of 3</div>
            <h2>Who should we thank? 💝</h2>
            <p className="muted">
              You’re gifting {tray.length} {tray.length === 1 ? "item" : "items"}.
              Leave your name so the family knows who to thank, and add a note if
              you’d like.
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
              {submitting ? "Finishing…" : "Finish 🎉"}
            </button>
            <button
              className="btn ghost block"
              style={{ marginTop: 8 }}
              onClick={() => goToStep(2)}
            >
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ─────────────── Thank you ─────────────── */}
      {done && (
        <div className="wizard">
          <div className="wizard-card center">
            <div style={{ fontSize: 52, marginBottom: 6 }}>🤍</div>
            <h2>Thank you{name ? `, ${name.split(" ")[0]}` : ""}!</h2>
            <p className="muted">
              Your gifts are confirmed and the family will be so grateful. If you
              haven’t finished checking out at the store yet, don’t forget to
              complete your purchase using the store links.
            </p>
            <button
              className="btn block"
              style={{ marginTop: 18 }}
              onClick={() => {
                setDone(false);
                setName("");
                setMessage("");
                goToStep(1);
              }}
            >
              Back to the registry
            </button>
          </div>
        </div>
      )}

      {/* ─────────────── Intro overlay (first visit this session) ─────────────── */}
      {showIntro && !done && (
        <div className="overlay modal-center">
          <div className="modal intro-modal">
            <div className="eyebrow">Welcome</div>
            <h2>How this works</h2>
            <p className="muted">Gifting takes just three simple steps.</p>

            <ol className="intro-steps">
              <li>
                <span className="istep-num">1</span>
                <div>
                  <strong>Select your gifts</strong>
                  <p>Choose the items you’d like to give, then hit Next.</p>
                </div>
              </li>
              <li>
                <span className="istep-num">2</span>
                <div>
                  <strong>Reserve &amp; buy</strong>
                  <p>
                    We’ll hold your picks for {HOLD_LABEL} while you purchase them.
                    Ship them to the address we show you, then come back and hit Next.
                  </p>
                </div>
              </li>
              <li>
                <span className="istep-num">3</span>
                <div>
                  <strong>Confirm who you are</strong>
                  <p>Tell us your name so the family can thank you, then hit Finish.</p>
                </div>
              </li>
            </ol>

            <button className="btn block" style={{ marginTop: 8 }} onClick={dismissIntro}>
              Let’s get started →
            </button>
          </div>
        </div>
      )}

      {/* ─────────────── Quantity picker (multi-unit items) ─────────────── */}
      {qtyModal && (
        <div className="overlay modal-center" onClick={() => setQtyModal(null)}>
          <div className="modal center" onClick={(e) => e.stopPropagation()}>
            <h2>How many?</h2>
            <p className="muted" style={{ marginBottom: 4 }}>{qtyModal.item.name}</p>
            <p className="muted" style={{ fontSize: 13 }}>
              {qtyModal.item.remaining} still needed. Pick how many you’d like to gift.
            </p>

            <div className="qty-stepper">
              <button
                className="qty-btn"
                aria-label="Decrease"
                disabled={qtyModal.qty <= 1}
                onClick={() => setQtyModal((m) => (m ? { ...m, qty: Math.max(1, m.qty - 1) } : m))}
              >
                −
              </button>
              <span className="qty-value">{qtyModal.qty}</span>
              <button
                className="qty-btn"
                aria-label="Increase"
                disabled={qtyModal.qty >= qtyModal.item.remaining}
                onClick={() =>
                  setQtyModal((m) =>
                    m ? { ...m, qty: Math.min(m.item.remaining, m.qty + 1) } : m,
                  )
                }
              >
                +
              </button>
            </div>

            <button
              className="btn block"
              style={{ marginTop: 20 }}
              onClick={() => reserveMany(qtyModal.item, qtyModal.qty)}
            >
              Gift {qtyModal.qty}
            </button>
            <button
              className="btn ghost block"
              style={{ marginTop: 8 }}
              onClick={() => setQtyModal(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

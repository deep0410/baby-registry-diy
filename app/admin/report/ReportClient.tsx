"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminItem, Claim } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePrice(p: string): number {
  if (!p) return 0;
  const m = p.match(/[\d.,]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) || 0 : 0;
}

function currencyPrefix(items: AdminItem[]): string {
  const sample = items.find((i) => i.price && parsePrice(i.price) > 0)?.price ?? "";
  const m = sample.match(/^([^\d]+)/);
  return m ? m[1] : "$";
}

function fmt(n: number, prefix: string): string {
  return `${prefix}${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ThankYouEntry {
  name: string;
  message: string;
  items: { name: string; qty: number }[];
  claimedAt: string;
  total: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: accent ? "var(--accent, #f5e6d8)" : "var(--bg-card, #fdf8f5)",
        border: "1.5px solid var(--border)",
        borderRadius: 10,
        padding: "14px 22px",
        minWidth: 190,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.45rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
  color: "var(--muted)",
};
const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "top",
  fontSize: 13,
};

export default function ReportClient() {
  const router = useRouter();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameFilter, setNameFilter] = useState("");
  const [selectedBuyers, setSelectedBuyers] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/admin/items", { cache: "no-store" })
      .then((r) => {
        if (r.status === 401) {
          router.push("/admin/login");
          throw new Error("unauth");
        }
        return r.json();
      })
      .then((d) => {
        setItems(d.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  // All unique buyer names across all items
  const allBuyers = useMemo<string[]>(() => {
    const names = new Set<string>();
    items.forEach((item) => item.claims.forEach((c) => names.add(c.purchaserName)));
    return Array.from(names).sort();
  }, [items]);

  const toggleBuyer = (name: string) =>
    setSelectedBuyers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Rows to show: non-archived, name filter, buyer filter
  const filtered = useMemo<AdminItem[]>(() => {
    const lc = nameFilter.toLowerCase();
    return items
      .filter((i) => !i.archived)
      .filter((i) => !lc || i.name.toLowerCase().includes(lc))
      .filter((i) =>
        selectedBuyers.size === 0
          ? true
          : i.claims.some((c) => selectedBuyers.has(c.purchaserName))
      );
  }, [items, nameFilter, selectedBuyers]);

  // Stats
  const stats = useMemo(() => {
    const active = items.filter((i) => !i.archived);
    const totalAll = active.reduce((s, i) => s + parsePrice(i.price) * i.quantity, 0);
    const totalPurchased = active.reduce((s, i) => s + parsePrice(i.price) * i.claimed, 0);
    const totalOutstanding = active.reduce((s, i) => s + parsePrice(i.price) * i.remaining, 0);

    // Buyer-filtered: sum only the selected buyers' claims inside the filtered rows
    let filteredPurchased = 0;
    if (selectedBuyers.size > 0) {
      filtered.forEach((item) => {
        const count = item.claims.filter((c) => selectedBuyers.has(c.purchaserName)).length;
        filteredPurchased += parsePrice(item.price) * count;
      });
    }

    return { totalAll, totalPurchased, totalOutstanding, filteredPurchased };
  }, [items, filtered, selectedBuyers]);

  // Group confirmed purchases by (purchaser, message) — that pairing is the
  // closest we have to "one checkout session," since a single guest submission
  // shares the same name + message across every item in it. Admin-marked
  // purchases (no real guest behind them) are excluded.
  const thankYouEntries = useMemo<ThankYouEntry[]>(() => {
    const groups = new Map<string, ThankYouEntry>();
    items
      .filter((i) => !i.archived)
      .forEach((item) => {
        item.claims.forEach((c) => {
          if (c.byAdmin) return;
          if (selectedBuyers.size > 0 && !selectedBuyers.has(c.purchaserName)) return;
          const key = `${c.purchaserName} ${c.message}`;
          let entry = groups.get(key);
          if (!entry) {
            entry = { name: c.purchaserName, message: c.message, items: [], claimedAt: c.claimedAt || "", total: 0 };
            groups.set(key, entry);
          }
          if (c.claimedAt && (!entry.claimedAt || c.claimedAt < entry.claimedAt)) entry.claimedAt = c.claimedAt;
          const existing = entry.items.find((it) => it.name === item.name);
          if (existing) existing.qty += 1;
          else entry.items.push({ name: item.name, qty: 1 });
          entry.total += parsePrice(item.price);
        });
      });
    return Array.from(groups.values()).sort(
      (a, b) => a.name.localeCompare(b.name) || a.claimedAt.localeCompare(b.claimedAt)
    );
  }, [items, selectedBuyers]);

  const printThankYouList = () => {
    if (thankYouEntries.length === 0) return;
    const win = window.open("", "_blank");
    if (!win) {
      alert("Please allow pop-ups for this site to print the thank-you list.");
      return;
    }
    const prefix = currencyPrefix(items);
    const grandTotal = thankYouEntries.reduce((s, e) => s + e.total, 0);

    const rows = thankYouEntries
      .map(
        (e) => `
        <div class="entry">
          <div class="entry-top">
            <div class="name">${escapeHtml(e.name)}</div>
            <div class="amount">${fmt(e.total, prefix)}</div>
          </div>
          <div class="items">${e.items
            .map((it) => escapeHtml(it.name) + (it.qty > 1 ? ` ×${it.qty}` : ""))
            .join(", ")}</div>
          <div class="message">${
            e.message.trim()
              ? `“${escapeHtml(e.message.trim())}”`
              : `<span class="muted">No message left</span>`
          }</div>
        </div>`
      )
      .join("");

    win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Thank-You List</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; margin: 40px; color: #2b2320; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { font-size: 12px; color: #78706a; margin-bottom: 28px; }
  .entry { padding: 14px 0; border-bottom: 1px solid #e4dcd3; break-inside: avoid; }
  .entry-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .name { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .amount { font-weight: 700; font-size: 14px; white-space: nowrap; }
  .items { font-size: 13px; color: #4a423c; margin-bottom: 4px; }
  .message { font-size: 13px; font-style: italic; color: #6a5c4e; }
  .muted { color: #a89e94; font-style: normal; }
  .grand-total { display: flex; justify-content: space-between; padding-top: 16px; margin-top: 4px; font-weight: 700; font-size: 15px; }
  @media print {
    body { margin: 20px; }
    .entry { break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>Thank-You List</h1>
  <div class="subtitle">${thankYouEntries.length} ${thankYouEntries.length === 1 ? "entry" : "entries"} — generated ${new Date().toLocaleDateString()}</div>
  ${rows}
  <div class="grand-total"><span>Total spent</span><span>${fmt(grandTotal, prefix)}</span></div>
</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const prefix = currencyPrefix(items);
  const buyerLabel =
    selectedBuyers.size === 0
      ? ""
      : Array.from(selectedBuyers).length > 2
        ? `${Array.from(selectedBuyers).slice(0, 2).join(", ")} +${selectedBuyers.size - 2}`
        : Array.from(selectedBuyers).join(", ");

  return (
    <div className="admin-wrap">
      {/* ── Header ── */}
      <div className="admin-top">
        <h1 className="serif">Baby Registry Report</h1>
        <div className="row" style={{ flex: "none", gap: 8 }}>
          <button
            className="btn small"
            onClick={printThankYouList}
            disabled={thankYouEntries.length === 0}
            title={
              thankYouEntries.length === 0
                ? "No messages yet"
                : `Print ${thankYouEntries.length} thank-you ${thankYouEntries.length === 1 ? "entry" : "entries"}${selectedBuyers.size > 0 ? ` (${buyerLabel})` : ""}`
            }
          >
            🖨️ Print thank-you list{selectedBuyers.size > 0 ? ` (${buyerLabel})` : ""}
          </button>
          <a className="btn ghost small" href="/admin/rsvp-report">RSVP Report</a>
          <a className="btn ghost small" href="/admin">← Admin</a>
          <a className="btn ghost small" href="/baby-registry" target="_blank" rel="noreferrer">
            View public site ↗
          </a>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="panel">
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* Name search */}
          <div>
            <label>Search name</label>
            <input
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="Filter by name…"
              style={{ width: 220 }}
            />
          </div>

          {/* Buyer chips */}
          {allBuyers.length > 0 && (
            <div>
              <label>Purchased by</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <button
                  className={`btn small${selectedBuyers.size === 0 ? "" : " ghost"}`}
                  onClick={() => setSelectedBuyers(new Set())}
                >
                  All
                </button>
                {allBuyers.map((name) => (
                  <button
                    key={name}
                    className={`btn small${selectedBuyers.has(name) ? "" : " ghost"}`}
                    onClick={() => toggleBuyer(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="panel" style={{ overflowX: "auto", padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>No items match the current filters.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)", background: "var(--bg-card, #fdf8f5)" }}>
                <th style={{ ...thStyle, width: "26%" }}>Name</th>
                <th style={thStyle}>Price</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Desired&nbsp;qty</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Purchased</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Outstanding</th>
                <th style={{ ...thStyle, width: "25%" }}>Purchased by</th>
                <th style={thStyle}>Link</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                // When a buyer filter is active, only surface those buyers' claims in the cell
                const visibleClaims: Claim[] =
                  selectedBuyers.size === 0
                    ? item.claims
                    : item.claims.filter((c) => selectedBuyers.has(c.purchaserName));

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: idx % 2 === 0 ? "transparent" : "var(--bg-card, #fdf8f5)",
                    }}
                  >
                    {/* Name */}
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{item.name}</td>

                    {/* Price */}
                    <td style={tdStyle}>{item.price || <span style={{ color: "var(--muted)" }}>—</span>}</td>

                    {/* Desired qty */}
                    <td style={{ ...tdStyle, textAlign: "center" }}>{item.quantity}</td>

                    {/* Purchased qty */}
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {item.claimed > 0 ? (
                        <span style={{ fontWeight: 600, color: "var(--accent-deep, #7a5c44)" }}>{item.claimed}</span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>0</span>
                      )}
                    </td>

                    {/* Outstanding */}
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {item.remaining > 0 ? (
                        item.remaining
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>

                    {/* Purchased by */}
                    <td style={tdStyle}>
                      {visibleClaims.length === 0 ? (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                      ) : (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {visibleClaims.map((c) => (
                            <span
                              key={c.slot}
                              className="pill green"
                              title={c.message ? `"${c.message}"` : undefined}
                            >
                              {c.purchaserName}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Link */}
                    <td style={tdStyle}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="link-out">
                          View ↗
                        </a>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Stats ── */}
      {!loading && (
        <div className="panel">
          <h3 style={{ marginBottom: 16 }}>Totals</h3>
          {selectedBuyers.size === 0 ? (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <StatCard label="Total value (all items)" value={fmt(stats.totalAll, prefix)} />
              <StatCard label="Total purchased" value={fmt(stats.totalPurchased, prefix)} accent />
              <StatCard label="Total outstanding" value={fmt(stats.totalOutstanding, prefix)} />
            </div>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <StatCard
                label={`Total purchased by ${buyerLabel}`}
                value={fmt(stats.filteredPurchased, prefix)}
                accent
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

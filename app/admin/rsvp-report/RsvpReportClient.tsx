"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Rsvp } from "@/lib/rsvp";

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
  textAlign: "left",
  color: "var(--muted)",
};
const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "top",
  fontSize: 13,
};

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
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

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Edit / Add modal ──────────────────────────────────────────────────────────

interface ModalState {
  mode: "add" | "edit";
  originalEmail?: string; // set in edit mode
  name: string;
  email: string;
  partySize: string;
}

function RsvpModal({
  state,
  onClose,
  onSaved,
}: {
  state: ModalState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(state.name);
  const [email, setEmail] = useState(state.email);
  const [partySize, setPartySize] = useState(state.partySize);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const isEdit = state.mode === "edit";
      const res = await fetch("/api/admin/rsvps", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { originalEmail: state.originalEmail } : {}),
          name,
          email,
          partySize: Number(partySize),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      onSaved();
    } catch {
      setError("Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!state.originalEmail) return;
    if (!confirm(`Remove the RSVP for ${state.originalEmail}?`)) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/rsvps?email=${encodeURIComponent(state.originalEmail)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      onSaved();
    } catch {
      setError("Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay modal-center" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="serif">{state.mode === "add" ? "Add RSVP" : "Edit RSVP"}</h2>
        {error && (
          <div className="rsvp-msg err" style={{ marginBottom: 12 }}>{error}</div>
        )}
        <form onSubmit={save}>
          <label htmlFor="m-name">Name</label>
          <input
            id="m-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            required
            autoFocus
          />

          <label htmlFor="m-email">Email</label>
          <input
            id="m-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="guest@example.com"
            required
          />

          <label htmlFor="m-party">Number of people</label>
          <input
            id="m-party"
            type="number"
            min={1}
            max={50}
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
            required
          />

          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : state.mode === "add" ? "Add RSVP" : "Save changes"}
            </button>
            <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {state.mode === "edit" && (
              <button
                className="btn danger"
                type="button"
                onClick={remove}
                disabled={busy}
                style={{ marginLeft: "auto" }}
              >
                Remove
              </button>
            )}
          </div>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
          Admin changes don&apos;t send a confirmation email to the guest.
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RsvpReportClient() {
  const router = useRouter();
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/rsvps", { cache: "no-store" })
      .then((r) => {
        if (r.status === 401) {
          router.push("/admin/login");
          throw new Error("unauth");
        }
        return r.json();
      })
      .then((d) => {
        setRsvps(d.rsvps || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const lc = filter.toLowerCase();
    return rsvps.filter(
      (r) => !lc || r.name.toLowerCase().includes(lc) || r.email.toLowerCase().includes(lc)
    );
  }, [rsvps, filter]);

  const totalPeople = useMemo(
    () => filtered.reduce((s, r) => s + (r.partySize || 0), 0),
    [filtered]
  );

  const exportCsv = () => {
    const header = "Name,Email,Number of people,RSVP'd at,Last updated";
    const rows = filtered.map((r) =>
      [
        csvEscape(r.name),
        csvEscape(r.email),
        String(r.partySize),
        r.createdAt,
        r.updatedAt,
      ].join(",")
    );
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rsvp-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => window.print();

  const openAdd = () =>
    setModal({ mode: "add", name: "", email: "", partySize: "1" });
  const openEdit = (r: Rsvp) =>
    setModal({
      mode: "edit",
      originalEmail: r.email,
      name: r.name,
      email: r.email,
      partySize: String(r.partySize),
    });

  return (
    <div className="admin-wrap">
      {/* ── Header ── */}
      <div className="admin-top">
        <h1 className="serif">RSVP Report</h1>
        <div className="row" style={{ flex: "none", gap: 8 }}>
          <button className="btn small" onClick={openAdd}>＋ Add RSVP</button>
          <button className="btn small ghost" onClick={exportCsv} disabled={filtered.length === 0}>
            ⬇️ Export CSV
          </button>
          <button className="btn small ghost" onClick={printReport} disabled={filtered.length === 0}>
            🖨️ Print
          </button>
          <a className="btn ghost small" href="/admin/report">Baby Registry Report</a>
          <a className="btn ghost small" href="/admin">← Admin</a>
        </div>
      </div>

      {/* ── Filter ── */}
      <div className="panel">
        <label>Search</label>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or email…"
          style={{ width: 260 }}
        />
      </div>

      {/* ── Table ── */}
      <div className="panel" style={{ overflowX: "auto", padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>
            {rsvps.length === 0 ? "No RSVPs yet." : "No RSVPs match the filter."}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)", background: "var(--bg-card, #fdf8f5)" }}>
                <th style={{ ...thStyle, width: "28%" }}>Name</th>
                <th style={{ ...thStyle, width: "32%" }}>Email</th>
                <th style={{ ...thStyle, textAlign: "center" }}>People</th>
                <th style={thStyle}>RSVP&apos;d</th>
                <th style={thStyle}>Last updated</th>
                <th style={{ ...thStyle, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr
                  key={r.email}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: idx % 2 === 0 ? "transparent" : "var(--bg-card, #fdf8f5)",
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.name}</td>
                  <td style={tdStyle}>
                    <a href={`mailto:${r.email}`} style={{ color: "inherit" }}>{r.email}</a>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center", fontWeight: 600 }}>{r.partySize}</td>
                  <td style={tdStyle}>
                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td style={tdStyle}>
                    {r.updatedAt && r.updatedAt !== r.createdAt
                      ? new Date(r.updatedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button className="btn ghost small" onClick={() => openEdit(r)}>
                      ✏️ Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Stats ── */}
      {!loading && (
        <div className="panel">
          <h3 style={{ marginBottom: 16 }}>Totals</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <StatCard label="Total RSVPs" value={String(filtered.length)} />
            <StatCard label="Total people attending" value={String(totalPeople)} accent />
          </div>
        </div>
      )}

      {/* ── Modal ── */}
      {modal && (
        <RsvpModal
          state={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setLoading(true);
            load();
          }}
        />
      )}
    </div>
  );
}

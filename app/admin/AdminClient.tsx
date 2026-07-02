"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminItem } from "@/lib/types";

interface FormState {
  name: string;
  url: string;
  quantity: number;
  price: string;
  imageUrl: string;
  imageKey: string;
  taxExempt: boolean;
}

interface BulkResult {
  url: string;
  quantity?: number;
  nameOverride?: string;
  status: "pending" | "fetching" | "done" | "error";
  name?: string;
  error?: string;
}

type PanelMode = "single" | "bulk" | null;

const emptyForm: FormState = { name: "", url: "", quantity: 1, price: "", imageUrl: "", imageKey: "", taxExempt: false };

export default function AdminClient() {
  const router = useRouter();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Single-item form
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetchingOg, setFetchingOg] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Bulk-import form
  const [bulkLinks, setBulkLinks] = useState("");
  const [bulkJsonError, setBulkJsonError] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/items", { cache: "no-store" });
    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3000);
  };

  const toggleMode = (mode: PanelMode) => {
    setPanelMode((prev) => (prev === mode ? null : mode));
    if (mode === "single") {
      setEditingId(null);
      setForm(emptyForm);
    }
    if (mode === "bulk") {
      setBulkResults([]);
      setBulkJsonError(null);
    }
  };

  // ── Single item helpers ──────────────────────────────────────────────────

  const previewSrc = () => {
    if (form.imageKey) return `/api/img?key=${encodeURIComponent(form.imageKey)}`;
    return form.imageUrl;
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const autoFetchPhoto = async () => {
    if (!form.url.trim()) return flash("Add a product link first.");
    setFetchingOg(true);
    try {
      const res = await fetch("/api/admin/og", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: form.url }),
      });
      const data = await res.json();
      const got: string[] = [];
      setForm((f) => {
        const next = { ...f };
        if (data.imageUrl) { next.imageUrl = data.imageUrl; next.imageKey = ""; got.push("photo"); }
        if (data.price)    { next.price = data.price; got.push("price"); }
        if (data.title && !f.name.trim()) { next.name = data.title; got.push("name"); }
        return next;
      });
      if (got.length) {
        flash(`Pulled ${got.join(", ")} from the link ✨`);
      } else {
        flash("Couldn't read that page (some stores block bots) — add details manually.");
      }
    } catch {
      flash("Couldn't read that link.");
    } finally {
      setFetchingOg(false);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const signRes = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!signRes.ok) {
        const d = await signRes.json();
        flash(d.error || "Upload not available (check S3 config).");
        return;
      }
      const { url, key } = await signRes.json();
      const put = await fetch(url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) { flash("Upload failed."); return; }
      setForm((f) => ({ ...f, imageKey: key, imageUrl: "" }));
      flash("Photo uploaded ✨");
    } catch {
      flash("Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return flash("Name is required.");
    setSaving(true);
    try {
      const payload = { name: form.name, url: form.url, quantity: form.quantity, price: form.price, imageUrl: form.imageUrl, imageKey: form.imageKey, taxExempt: form.taxExempt };
      const res = editingId
        ? await fetch(`/api/admin/items/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/admin/items",               { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) {
        flash(editingId ? "Item updated." : "Item added.");
        resetForm();
        load();
      } else {
        const d = await res.json();
        flash(d.error || "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (it: AdminItem) => {
    setPanelMode("single");
    setEditingId(it.id);
    setForm({ name: it.name, url: it.url, quantity: it.quantity, price: it.price || "", imageUrl: it.imageKey ? "" : it.imageUrl, imageKey: it.imageKey || "", taxExempt: !!it.taxExempt });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Bulk import ──────────────────────────────────────────────────────────

  const formatBulkJson = () => {
    try {
      const parsed = JSON.parse(bulkLinks.trim());
      setBulkLinks(JSON.stringify(parsed, null, 2));
      setBulkJsonError(null);
    } catch (e: any) {
      setBulkJsonError(e?.message || "Invalid JSON");
    }
  };

  const runBulkImport = async () => {
    setBulkJsonError(null);

    let entries: { link: string; quantity: number; name: string; taxExempt: boolean }[] = [];
    try {
      const parsed = JSON.parse(bulkLinks.trim());
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array [ … ]");
      entries = parsed
        .filter((e: any) => typeof e?.link === "string" && e.link.trim().startsWith("http"))
        .map((e: any) => ({
          link: e.link.trim(),
          quantity: Math.max(1, parseInt(String(e.quantity ?? 1), 10) || 1),
          name: typeof e.name === "string" ? e.name.trim() : "",
          taxExempt: e.taxExempt === true || e.taxExempt === "true",
        }));
    } catch (e: any) {
      setBulkJsonError(e?.message || "Invalid JSON");
      return;
    }

    if (entries.length === 0) return flash("No valid links found in the JSON.");

    setBulkResults(entries.map(({ link, quantity, name }) => ({ url: link, quantity, nameOverride: name || undefined, status: "pending" })));
    setBulkRunning(true);

    for (let i = 0; i < entries.length; i++) {
      const { link, quantity, name: nameOverride, taxExempt } = entries[i];
      setBulkResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "fetching" } : r));

      try {
        // 1. Fetch OG / product metadata
        const ogRes = await fetch("/api/admin/og", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: link }),
        });
        const og = await ogRes.json();

        // 2. Save item — prefer name from JSON, fall back to OG title
        const resolvedName = nameOverride || og.title || link;
        const saveRes = await fetch("/api/admin/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: resolvedName,
            url: link,
            imageUrl: og.imageUrl || "",
            price: og.price || "",
            quantity,
            taxExempt,
          }),
        });

        if (saveRes.ok) {
          setBulkResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "done", name: resolvedName } : r));
        } else {
          const d = await saveRes.json();
          setBulkResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "error", error: d.error || "Save failed" } : r));
        }
      } catch (e: any) {
        setBulkResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "error", error: e?.message || "Failed" } : r));
      }
    }

    setBulkRunning(false);
    load();
  };

  // ── Item actions ─────────────────────────────────────────────────────────

  const action = async (id: string, act: string, slot?: number) => {
    const res = await fetch(`/api/admin/items/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act, slot }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.reason === "nothing_available") flash("All units are already accounted for.");
    load();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its purchase records? This can't be undone.`)) return;
    await fetch(`/api/admin/items/${id}`, { method: "DELETE" });
    load();
  };

  const toggleArchive = async (it: AdminItem) => {
    await fetch(`/api/admin/items/${it.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !it.archived }),
    });
    load();
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const bulkDone  = bulkResults.filter((r) => r.status === "done").length;
  const bulkError = bulkResults.filter((r) => r.status === "error").length;

  return (
    <div className="admin-wrap">
      <div className="admin-top">
        <h1 className="serif">Registry Admin</h1>
        <div className="row" style={{ flex: "none" }}>
          <a className="btn ghost small" href="/admin/report">Report</a>
          <a className="btn ghost small" href="/" target="_blank" rel="noreferrer">View public site ↗</a>
          <button className="btn ghost small" onClick={logout}>Sign out</button>
        </div>
      </div>

      {/* ── Mode toggle ── */}
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <button
          className={`btn small ${panelMode === "single" ? "" : "ghost"}`}
          onClick={() => toggleMode("single")}
        >
          + Add item
        </button>
        <button
          className={`btn small ${panelMode === "bulk" ? "" : "ghost"}`}
          onClick={() => toggleMode("bulk")}
        >
          + Bulk add items
        </button>
      </div>

      {/* ── Single item form ── */}
      {panelMode === "single" && (
        <div className="panel">
          <h3>{editingId ? "Edit item" : "Add an item"}</h3>
          <div className="row">
            <div>
              <label>Item name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Baby Monitor" />
            </div>
            <div style={{ flex: "0 0 120px" }}>
              <label>Quantity needed</label>
              <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
          </div>
          <div className="row">
            <div>
              <label>Product link</label>
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://www.amazon.com/..." />
            </div>
            <div style={{ flex: "0 0 140px" }}>
              <label>Price</label>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="$0.00" />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, marginTop: 2 }}>
            <input
              type="checkbox"
              checked={form.taxExempt}
              onChange={(e) => setForm({ ...form, taxExempt: e.target.checked })}
              style={{ width: "auto" }}
            />
            No tax on this item (skip the tax multiplier on the public site)
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Tip: paste the link, then use "Auto-fill from link" to grab the photo, price, and name.
          </p>

          <label>Photo</label>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value, imageKey: "" })} placeholder="Paste an image URL, or use the buttons →" />
              <div className="adm-actions">
                <button className="btn ghost small" onClick={autoFetchPhoto} disabled={fetchingOg} type="button">
                  {fetchingOg ? "Reading link…" : "Auto-fill from link"}
                </button>
                <label className="btn ghost small" style={{ display: "inline-block", margin: 0 }}>
                  {uploading ? "Uploading…" : "Upload photo"}
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
                </label>
              </div>
            </div>
            <div style={{ flex: "0 0 90px" }}>
              {previewSrc()
                ? <img className="adm-thumb" src={previewSrc()} alt="preview" /> // eslint-disable-line @next/next/no-img-element
                : <div className="adm-thumb" />}
            </div>
          </div>

          <div className="adm-actions" style={{ marginTop: 16 }}>
            <button className="btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add item"}
            </button>
            {editingId && <button className="btn ghost" onClick={resetForm} type="button">Cancel</button>}
          </div>
        </div>
      )}

      {/* ── Bulk import form ── */}
      {panelMode === "bulk" && (
        <div className="panel">
          <h3>Bulk add items</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Paste a JSON array. Required: <code>link</code>. Optional: <code>quantity</code> (default 1), <code>name</code> (skips scraping if provided), and <code>taxExempt</code> (default false — set true to skip tax on this item). Price and photo are always auto-filled from the link.
          </p>
          <label>Items JSON</label>
          <textarea
            rows={10}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12, resize: "vertical", border: bulkJsonError ? "1.5px solid #c0392b" : undefined }}
            value={bulkLinks}
            onChange={(e) => { setBulkLinks(e.target.value); setBulkResults([]); setBulkJsonError(null); }}
            placeholder={`[\n  { "link": "https://www.amazon.ca/dp/...", "quantity": 1 },\n  { "link": "https://www.walmart.ca/en/ip/...", "quantity": 2, "name": "JOIE Ayr Stroller" },\n  { "link": "https://www.ikea.com/ca/en/p/...", "quantity": 1, "taxExempt": true }\n]`}
            disabled={bulkRunning}
          />
          {bulkJsonError && (
            <p style={{ fontSize: 12, color: "#c0392b", marginTop: 4 }}>⚠ {bulkJsonError}</p>
          )}
          <div className="adm-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={runBulkImport} disabled={bulkRunning || !bulkLinks.trim()}>
              {bulkRunning ? "Importing…" : "Import all"}
            </button>
            <button className="btn ghost" onClick={formatBulkJson} disabled={bulkRunning || !bulkLinks.trim()} type="button">
              Format JSON
            </button>
            {bulkResults.length > 0 && !bulkRunning && (
              <button className="btn ghost" onClick={() => { setBulkLinks(""); setBulkResults([]); setBulkJsonError(null); }}>
                Clear
              </button>
            )}
          </div>

          {/* Per-item progress */}
          {bulkResults.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {bulkDone > 0 || bulkError > 0 ? (
                <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                  {bulkDone} added{bulkError > 0 ? `, ${bulkError} failed` : ""}.
                </p>
              ) : null}
              {bulkResults.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 16, lineHeight: 1.4 }}>
                    {r.status === "pending"  && "⏳"}
                    {r.status === "fetching" && "🔄"}
                    {r.status === "done"     && "✓"}
                    {r.status === "error"    && "✗"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {r.name
                        ? <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                        : <span style={{ fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>{r.url}</span>}
                      {(r.quantity ?? 1) > 1 && (
                        <span style={{ fontSize: 10, background: "var(--accent, #e8d5c4)", borderRadius: 4, padding: "1px 6px" }}>
                          qty {r.quantity}
                        </span>
                      )}
                      {r.nameOverride && (
                        <span style={{ fontSize: 10, background: "#d5e8d4", borderRadius: 4, padding: "1px 6px" }}>
                          name set
                        </span>
                      )}
                    </div>
                    {r.status === "fetching" && <div style={{ fontSize: 11, color: "var(--muted)" }}>Fetching…</div>}
                    {r.status === "error"    && <div style={{ fontSize: 11, color: "#c0392b" }}>{r.error}</div>}
                    {r.status === "done"     && <div style={{ fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>{r.url}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Item list ── */}
      <div className="panel">
        <h3>Items ({items.length})</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">No items yet. Add your first one above.</p>
        ) : (
          items.map((it) => (
            <div className="adm-item" key={it.id} style={{ opacity: it.archived ? 0.55 : 1 }}>
              {it.imageUrl
                ? <img className="adm-thumb" src={it.imageUrl} alt={it.name} /> // eslint-disable-line @next/next/no-img-element
                : <div className="adm-thumb" />}
              <div className="adm-main">
                <div className="adm-name">
                  {it.name}
                  {it.price && <span style={{ color: "var(--accent-deep)", marginLeft: 8 }}>{it.price}</span>}
                </div>
                <div style={{ margin: "6px 0" }}>
                  <span className="pill green">{it.claimed} purchased</span>
                  <span className="pill rose">{it.remaining} needed</span>
                  {it.held > 0 && <span className="pill">{it.held} on hold</span>}
                  <span className="pill">qty {it.quantity}</span>
                  {it.archived && <span className="pill">hidden</span>}
                  {it.taxExempt && <span className="pill">no tax</span>}
                </div>
                {it.url && (
                  <a className="link-out" href={it.url} target="_blank" rel="noreferrer">
                    {it.url.slice(0, 60)}
                  </a>
                )}
                {it.claims.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {it.claims.map((c) => (
                      <div className="claim-line" key={c.slot}>
                        <strong>{c.purchaserName}</strong>
                        {c.message ? ` — "${c.message}"` : ""}
                        <button className="ti-remove" style={{ marginLeft: 8 }} onClick={() => action(it.id, "removeSlot", c.slot)}>
                          {c.byAdmin ? "remove" : "undo"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="adm-actions">
                  <button className="btn ghost small" onClick={() => startEdit(it)}>Edit</button>
                  <button className="btn sage small" onClick={() => action(it.id, "markPurchased")} disabled={it.remaining <= 0}>Mark 1 purchased</button>
                  <button className="btn ghost small" onClick={() => action(it.id, "clearAll")}>Reset purchases</button>
                  <button className="btn ghost small" onClick={() => toggleArchive(it)}>{it.archived ? "Unhide" : "Hide"}</button>
                  <button className="btn danger small" onClick={() => remove(it.id, it.name)}>Delete</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}

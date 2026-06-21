"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminItem } from "@/lib/types";

interface FormState {
  name: string;
  url: string;
  quantity: number;
  imageUrl: string;
  imageKey: string;
}

const emptyForm: FormState = { name: "", url: "", quantity: 1, imageUrl: "", imageKey: "" };

export default function AdminClient() {
  const router = useRouter();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetchingOg, setFetchingOg] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3000);
  };

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
      if (data.imageUrl) {
        setForm((f) => ({ ...f, imageUrl: data.imageUrl, imageKey: "" }));
        flash("Photo found from the link ✨");
      } else {
        flash("Couldn’t find a photo on that page — paste a URL or upload instead.");
      }
    } catch {
      flash("Photo fetch failed.");
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
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        flash("Upload failed.");
        return;
      }
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
      const payload = {
        name: form.name,
        url: form.url,
        quantity: form.quantity,
        imageUrl: form.imageUrl,
        imageKey: form.imageKey,
      };
      const res = editingId
        ? await fetch(`/api/admin/items/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
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
    setEditingId(it.id);
    setForm({
      name: it.name,
      url: it.url,
      quantity: it.quantity,
      imageUrl: it.imageKey ? "" : it.imageUrl,
      imageKey: it.imageKey || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const action = async (id: string, action: string, slot?: number) => {
    const res = await fetch(`/api/admin/items/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, slot }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.reason === "nothing_available") flash("All units are already accounted for.");
    load();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete “${name}” and all its purchase records? This can’t be undone.`)) return;
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

  return (
    <div className="admin-wrap">
      <div className="admin-top">
        <h1 className="serif">Registry Admin</h1>
        <div className="row" style={{ flex: "none" }}>
          <a className="btn ghost small" href="/" target="_blank" rel="noreferrer">
            View public site ↗
          </a>
          <button className="btn ghost small" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>

      {/* Add / edit form */}
      <div className="panel">
        <h3>{editingId ? "Edit item" : "Add an item"}</h3>
        <div className="row">
          <div>
            <label>Item name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Baby Monitor"
            />
          </div>
          <div style={{ flex: "0 0 120px" }}>
            <label>Quantity needed</label>
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>
        </div>
        <label>Product link</label>
        <input
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="https://www.amazon.com/..."
        />

        <label>Photo</label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <input
              value={form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value, imageKey: "" })}
              placeholder="Paste an image URL, or use the buttons →"
            />
            <div className="adm-actions">
              <button className="btn ghost small" onClick={autoFetchPhoto} disabled={fetchingOg} type="button">
                {fetchingOg ? "Fetching…" : "Auto-fetch from link"}
              </button>
              <label
                className="btn ghost small"
                style={{ display: "inline-block", margin: 0 }}
              >
                {uploading ? "Uploading…" : "Upload photo"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                />
              </label>
            </div>
          </div>
          <div style={{ flex: "0 0 90px" }}>
            {previewSrc() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="adm-thumb" src={previewSrc()} alt="preview" />
            ) : (
              <div className="adm-thumb" />
            )}
          </div>
        </div>

        <div className="adm-actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add item"}
          </button>
          {editingId && (
            <button className="btn ghost" onClick={resetForm} type="button">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Item list */}
      <div className="panel">
        <h3>Items ({items.length})</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">No items yet. Add your first one above.</p>
        ) : (
          items.map((it) => (
            <div className="adm-item" key={it.id} style={{ opacity: it.archived ? 0.55 : 1 }}>
              {it.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="adm-thumb" src={it.imageUrl} alt={it.name} />
              ) : (
                <div className="adm-thumb" />
              )}
              <div className="adm-main">
                <div className="adm-name">{it.name}</div>
                <div style={{ margin: "6px 0" }}>
                  <span className="pill green">{it.claimed} purchased</span>
                  <span className="pill rose">{it.remaining} needed</span>
                  {it.held > 0 && <span className="pill">{it.held} on hold</span>}
                  <span className="pill">qty {it.quantity}</span>
                  {it.archived && <span className="pill">hidden</span>}
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
                        {c.message ? ` — “${c.message}”` : ""}
                        {!c.byAdmin && (
                          <button
                            className="ti-remove"
                            style={{ marginLeft: 8 }}
                            onClick={() => action(it.id, "removeSlot", c.slot)}
                          >
                            undo
                          </button>
                        )}
                        {c.byAdmin && (
                          <button
                            className="ti-remove"
                            style={{ marginLeft: 8 }}
                            onClick={() => action(it.id, "removeSlot", c.slot)}
                          >
                            remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="adm-actions">
                  <button className="btn ghost small" onClick={() => startEdit(it)}>
                    Edit
                  </button>
                  <button
                    className="btn sage small"
                    onClick={() => action(it.id, "markPurchased")}
                    disabled={it.remaining <= 0}
                  >
                    Mark 1 purchased
                  </button>
                  <button className="btn ghost small" onClick={() => action(it.id, "clearAll")}>
                    Reset purchases
                  </button>
                  <button className="btn ghost small" onClick={() => toggleArchive(it)}>
                    {it.archived ? "Unhide" : "Hide"}
                  </button>
                  <button className="btn danger small" onClick={() => remove(it.id, it.name)}>
                    Delete
                  </button>
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

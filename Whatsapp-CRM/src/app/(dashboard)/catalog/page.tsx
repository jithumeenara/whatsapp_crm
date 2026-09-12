"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ShoppingBag, Plus, Search, Loader2, ImageOff, Pencil, Trash2, X,
  Clock, CheckCircle2, AlertTriangle, RefreshCw, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmIconDialog } from "@/components/ui/confirm-icon-dialog";
import { formatCurrency } from "@/lib/currency";

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" "); }

interface Product {
  id: string;
  retailer_id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  availability: string;
  category: string | null;
  brand: string | null;
  sync_status: string;
  updated_at: string;
}

const SYNC_BADGE: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  synced: { label: "Synced", cls: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-700", icon: Clock },
  error: { label: "Sync error", cls: "bg-red-50 text-red-700", icon: AlertTriangle },
};

const EMPTY_FORM = {
  name: "", description: "", price: "", currency: "USD",
  image_url: "", availability: "in stock", category: "", brand: "", retailer_id: "",
};

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  async function handlePhotoPick(file: File) {
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Upload failed.");
        return;
      }
      setForm((f) => ({ ...f, image_url: data.url as string }));
    } catch {
      toast.error("Upload failed — network error.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function load(q?: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/products${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch {
      toast.error("Failed to load products.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      price: p.price != null ? String(p.price) : "",
      currency: p.currency ?? "USD",
      image_url: p.image_url ?? "",
      availability: p.availability,
      category: p.category ?? "",
      brand: p.brand ?? "",
      retailer_id: p.retailer_id,
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Product name is required.");
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/catalog/products/${editing.id}` : "/api/catalog/products";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          price: form.price.trim() ? Number(form.price) : "",
          currency: form.currency.trim() || "USD",
          image_url: form.image_url.trim() || undefined,
          availability: form.availability,
          category: form.category.trim() || undefined,
          brand: form.brand.trim() || undefined,
          ...(editing ? {} : { retailer_id: form.retailer_id.trim() || undefined }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save product.");
        return;
      }
      if (data.warning) toast.warning(data.warning);
      else toast.success(editing ? "Product updated." : "Product added.");
      setFormOpen(false);
      await load(search);
    } catch {
      toast.error("Failed to save — network error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/catalog/products/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (data?.warning) toast.warning(data.warning);
      else toast.success("Product removed.");
      setDeleteTarget(null);
      await load(search);
    } catch {
      toast.error("Failed to remove — network error.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <ShoppingBag className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-slate-900">Catalog</h1>
            <p className="text-[12px] text-slate-500">Products customers can browse and buy from inside WhatsApp</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="h-9 w-56 pl-8 text-sm" />
          </div>
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Product
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <Package className="h-8 w-8 text-slate-300" />
            <p className="text-[13px] font-medium text-slate-600">No products yet</p>
            <p className="text-[12px] text-slate-400">Add your first product, or connect a catalog and sync from Meta in Settings.</p>
            <Button size="sm" onClick={openCreate} className="mt-2 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Product
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {products.map((p) => {
              const badge = SYNC_BADGE[p.sync_status] ?? SYNC_BADGE.pending;
              const BadgeIcon = badge.icon;
              return (
                <div key={p.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                  <div className="flex h-32 items-center justify-center bg-slate-50">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <ImageOff className="h-6 w-6 text-slate-300" />
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-[13px] font-medium text-slate-800">{p.name}</p>
                    <p className="text-[12px] text-slate-500 [font-variant-numeric:tabular-nums]">
                      {p.price != null ? formatCurrency(p.price, p.currency || undefined) : "No price"}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", badge.cls)}>
                        <BadgeIcon className="h-2.5 w-2.5" />
                        {badge.label}
                      </span>
                      <span className="text-[10px] text-slate-400">{p.availability}</span>
                    </div>
                  </div>
                  <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => openEdit(p)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow hover:bg-white">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={() => setDeleteTarget(p)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-red-500 shadow hover:bg-white">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">Photo</Label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {form.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff className="h-5 w-5 text-slate-300" />
                  )}
                </div>
                <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50">
                  {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {uploadingPhoto ? "Uploading…" : "Upload photo"}
                  <input autoComplete="off"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoPick(f); e.target.value = ""; }}
                  />
                </label>
                {form.image_url && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, image_url: "" }))} className="text-[12px] text-slate-400 hover:text-red-500">
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 text-[12px] text-slate-600">Price</Label>
                <Input type="number" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="mb-1 text-[12px] text-slate-600">Currency</Label>
                <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 text-[12px] text-slate-600">Category</Label>
                <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="mb-1 text-[12px] text-slate-600">Brand</Label>
                <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} className="h-9 text-sm" />
              </div>
            </div>
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">Availability</Label>
              <select
                value={form.availability}
                onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value }))}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-100"
              >
                <option value="in stock">In stock</option>
                <option value="out of stock">Out of stock</option>
                <option value="preorder">Preorder</option>
              </select>
            </div>
            {!editing && (
              <div>
                <Label className="mb-1 text-[12px] text-slate-600">SKU (optional)</Label>
                <Input value={form.retailer_id} onChange={(e) => setForm((f) => ({ ...f, retailer_id: e.target.value }))} placeholder="Auto-generated if left blank" className="h-9 font-mono text-sm" />
              </div>
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>
              <X className="mr-1 h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : editing ? "Save changes" : "Add product"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmIconDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        icon={Trash2}
        tone="danger"
        title="Remove this product?"
        description={`"${deleteTarget?.name}" will be removed from your catalog and Meta's catalog.`}
        actionLabel="Remove"
        actionPendingLabel="Removing…"
        onConfirm={handleDelete}
        pending={deleting}
      />
    </div>
  );
}

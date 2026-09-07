"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { Loader2, Search, ShoppingBag, Package, LayoutGrid, Check, ImageOff, Send } from "lucide-react";

interface CatalogProduct {
  id: string;
  retailer_id: string;
  name: string;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  availability: string;
}

export interface CatalogSendPayload {
  message_type: "catalog" | "single_product" | "multi_product";
  content_text: string;
  catalog_footer_text?: string;
  catalog_thumbnail_retailer_id?: string;
  product_retailer_id?: string;
  catalog_header_text?: string;
  catalog_sections?: { title?: string; productRetailerIds: string[] }[];
  /** Short human label for the optimistic bubble ("Catalog", "Product: Blue Mug", "3 products"). */
  previewLabel: string;
}

interface CatalogPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (payload: CatalogSendPayload) => void;
}

type Mode = "catalog" | "single_product" | "multi_product";

const MODES: { key: Mode; label: string; icon: typeof ShoppingBag; hint: string }[] = [
  { key: "catalog", label: "Whole Catalog", icon: ShoppingBag, hint: "Send the whole connected catalog as one browsable message." },
  { key: "single_product", label: "One Product", icon: Package, hint: "Highlight a single product." },
  { key: "multi_product", label: "Product Picks", icon: LayoutGrid, hint: "A curated pick of up to 30 products." },
];

const MAX_MULTI = 30;

export function CatalogPicker({ open, onOpenChange, onSend }: CatalogPickerProps) {
  const [mode, setMode] = useState<Mode>("catalog");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bodyText, setBodyText] = useState("");
  const [headerText, setHeaderText] = useState("Take a look at these");
  const [footerText, setFooterText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset to a clean state each time it's opened.
    setMode("catalog");
    setSelectedIds(new Set());
    setSearch("");
    setBodyText("Have a look at what we've got!");
    setHeaderText("Take a look at these");
    setFooterText("");
  }, [open]);

  useEffect(() => {
    if (!open || mode === "catalog") return;
    let cancelled = false;
    setLoadingProducts(true);
    const q = search.trim();
    fetch(`/api/catalog/products${q ? `?search=${encodeURIComponent(q)}` : ""}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setProducts(data.products ?? []); })
      .catch(() => { if (!cancelled) setProducts([]); })
      .finally(() => { if (!cancelled) setLoadingProducts(false); });
    return () => { cancelled = true; };
  }, [open, mode, search]);

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id)),
    [products, selectedIds],
  );

  function toggleSelect(product: CatalogProduct) {
    if (mode === "single_product") {
      setSelectedIds(new Set([product.id]));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(product.id)) {
        next.delete(product.id);
      } else if (next.size < MAX_MULTI) {
        next.add(product.id);
      }
      return next;
    });
  }

  const canSend =
    mode === "catalog"
      ? bodyText.trim().length > 0
      : mode === "single_product"
        ? selectedProducts.length === 1
        : selectedProducts.length > 0 && bodyText.trim().length > 0 && headerText.trim().length > 0;

  async function handleSend() {
    if (!canSend || sending) return;
    setSending(true);
    try {
      if (mode === "catalog") {
        onSend({
          message_type: "catalog",
          content_text: bodyText.trim(),
          catalog_footer_text: footerText.trim() || undefined,
          previewLabel: "Catalog",
        });
      } else if (mode === "single_product") {
        const p = selectedProducts[0];
        onSend({
          message_type: "single_product",
          content_text: bodyText.trim(),
          catalog_footer_text: footerText.trim() || undefined,
          product_retailer_id: p.retailer_id,
          previewLabel: `Product: ${p.name}`,
        });
      } else {
        onSend({
          message_type: "multi_product",
          content_text: bodyText.trim(),
          catalog_header_text: headerText.trim(),
          catalog_footer_text: footerText.trim() || undefined,
          catalog_sections: [{ productRetailerIds: selectedProducts.map((p) => p.retailer_id) }],
          previewLabel: `${selectedProducts.length} product${selectedProducts.length === 1 ? "" : "s"}`,
        });
      }
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-slate-100 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="h-4 w-4 text-sky-600" />
            Send from Catalog
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
          {MODES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setMode(key); setSelectedIds(new Set()); }}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                mode === key
                  ? "border-sky-300 bg-sky-100 text-sky-800"
                  : "border-transparent bg-white text-slate-600 hover:bg-slate-100",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {mode !== "catalog" && (
            <>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products…"
                  className="h-8 pl-8 text-sm"
                />
              </div>

              {mode === "multi_product" && (
                <p className="mb-2 text-[11px] text-slate-400">
                  {selectedProducts.length} / {MAX_MULTI} selected
                </p>
              )}

              <div className="mb-4 grid grid-cols-2 gap-2">
                {loadingProducts ? (
                  <div className="col-span-2 flex items-center justify-center py-8 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : products.length === 0 ? (
                  <p className="col-span-2 py-8 text-center text-sm text-slate-400">
                    No products found. Add some in the Catalog page first.
                  </p>
                ) : (
                  products.map((p) => {
                    const selected = selectedIds.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleSelect(p)}
                        className={cn(
                          "relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
                          selected ? "border-sky-400 ring-1 ring-sky-300" : "border-slate-200 hover:border-slate-300",
                        )}
                      >
                        <div className="flex h-20 items-center justify-center bg-slate-50">
                          {p.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                          ) : (
                            <ImageOff className="h-5 w-5 text-slate-300" />
                          )}
                        </div>
                        <div className="px-2 py-1.5">
                          <p className="truncate text-xs font-medium text-slate-800">{p.name}</p>
                          <p className="text-[11px] text-slate-500 [font-variant-numeric:tabular-nums]">
                            {p.price != null ? formatCurrency(p.price, p.currency || undefined) : "No price"}
                          </p>
                        </div>
                        {selected && (
                          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-white shadow">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {mode === "multi_product" && (
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Header</label>
              <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} className="h-8 text-sm" />
            </div>
          )}

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {mode === "single_product" ? "Message (optional)" : "Message"}
            </label>
            <Textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              maxLength={1024}
              rows={2}
              className="text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Footer (optional)</label>
            <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} maxLength={60} className="h-8 text-sm" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <p className="text-[11px] text-slate-400">{MODES.find((m) => m.key === mode)?.hint}</p>
          <Button size="sm" disabled={!canSend || sending} onClick={handleSend} className="gap-1.5">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

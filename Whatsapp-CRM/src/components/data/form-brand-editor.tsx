"use client"

/**
 * The form's business header: logo, name, tagline, colour, and whether
 * the company's contact details appear at the foot.
 */

import { useRef, useState } from "react"
import { toast } from "sonner"
import { Check, FolderOpen, ImagePlus, Loader2, Trash2, Upload } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { FileManagerPicker } from "@/components/inbox/file-manager-picker"
import { BRAND_COLORS, type BrandColor, type FormBrand } from "@/lib/data-store/form-logic"

const FIELD =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
const IMAGE = /^image\/(png|jpeg|webp|gif)$/
const MAX_LOGO = 2 * 1024 * 1024

export interface LogoPreview {
  id: string
  url: string
  name: string
}

export function FormBrandEditor({
  brand,
  logo,
  placeholderName,
  onChange,
}: {
  brand: FormBrand
  logo: LogoPreview | null
  placeholderName: string
  onChange(patch: Partial<FormBrand>, logo?: LogoPreview | null): void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (!IMAGE.test(file.type)) {
      toast.error("Choose a PNG, JPG, WebP or GIF image")
      return
    }
    if (file.size > MAX_LOGO) {
      toast.error("The logo can be 2 MB at most")
      return
    }
    setUploading(true)
    try {
      // The same checked upload the email uses: type allowlist, and the
      // bytes must really be an image.
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/email/attachments", { method: "POST", body: form })
      const data = (await res.json().catch(() => ({}))) as { file?: { id: string; url: string; name: string }; error?: string }
      if (!res.ok || !data.file) throw new Error(data.error || "Could not upload the logo")
      onChange({ logo_file_id: data.file.id }, { id: data.file.id, url: data.file.url, name: data.file.name })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload the logo")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
          style={{ backgroundColor: logo ? "#fff" : undefined }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.url} alt="Logo" className="h-full w-full object-contain p-1" />
          ) : (
            <ImagePlus className="h-5 w-5 text-slate-300" />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5 text-[12.5px]">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload logo
            </button>
            <button type="button" onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
              <FolderOpen className="h-3.5 w-3.5" /> File Manager
            </button>
            {logo && (
              <button type="button" onClick={() => onChange({ logo_file_id: null }, null)} aria-label="Remove logo"
                className="inline-flex items-center rounded-lg px-2 py-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <span className="text-[11.5px] text-slate-400">Square PNG or JPG, up to 2 MB</span>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-hidden="true" tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f) }} />
      </div>

      <input
        id="form-brand-name"
        value={brand.name ?? ""}
        onChange={(e) => onChange({ name: e.target.value || null })}
        placeholder={placeholderName || "Business name"}
        maxLength={120}
        aria-label="Business name on the form"
        className={FIELD}
      />
      <input
        id="form-brand-tagline"
        value={brand.tagline ?? ""}
        onChange={(e) => onChange({ tagline: e.target.value || null })}
        placeholder="A line under the name (optional)"
        maxLength={160}
        aria-label="Tagline"
        className={FIELD}
      />

      <div>
        <p className="mb-1.5 text-[12px] text-slate-600">Colour</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Form colour">
          {(Object.keys(BRAND_COLORS) as BrandColor[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={brand.color === c}
              title={BRAND_COLORS[c].label}
              onClick={() => onChange({ color: c })}
              className="grid h-8 w-8 place-items-center rounded-full ring-offset-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              style={{ backgroundColor: BRAND_COLORS[c].hex, boxShadow: brand.color === c ? `0 0 0 2px #fff, 0 0 0 4px ${BRAND_COLORS[c].hex}` : undefined }}
            >
              {brand.color === c && <Check className="h-4 w-4 text-white" />}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-start justify-between gap-3 text-[13px] text-slate-700">
        <span>
          Show contact details
          <span className="block text-[11.5px] text-slate-400">Phone, email, website and address from Settings → Company profile.</span>
        </span>
        <Switch checked={brand.show_contact} onCheckedChange={(v) => onChange({ show_contact: v })} />
      </label>

      <FileManagerPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(file) => {
          if (!IMAGE.test(file.mime_type)) { toast.error("Choose an image (PNG, JPG, WebP or GIF)"); return }
          if (file.size > MAX_LOGO) { toast.error("The logo can be 2 MB at most"); return }
          onChange({ logo_file_id: file.id }, { id: file.id, url: file.url, name: file.original_name })
          setPickerOpen(false)
        }}
      />
    </div>
  )
}

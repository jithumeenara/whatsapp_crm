/**
 * Lead Magnet — the product mark: three channels converging on one lead.
 * Same drawing as public/brand/lead-magnet-mark.svg, inline so it shows
 * at once and needs no request. Interim logo; the kit is in public/brand.
 */
export function LeadMagnetMark({ className, title }: Readonly<{ className?: string; title?: string }>) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g fill="none" strokeLinecap="round" strokeWidth={30}>
        <line x1="40" y1="204" x2="92" y2="130" stroke="#4C1D95" />
        <line x1="86" y1="224" x2="170" y2="104" stroke="#6D28D9" />
        <line x1="140" y1="226" x2="194" y2="149" stroke="#9333EA" />
      </g>
      <circle cx="201" cy="58" r="25" fill="#A855F7" />
    </svg>
  )
}

/** Mark + "Lead Magnet" + a small "CRM" — the sidebar and login lockup. */
export function LeadMagnetLogo({ size = "md", className }: Readonly<{ size?: "sm" | "md" | "lg"; className?: string }>) {
  const s = {
    sm: { mark: "h-6 w-6", name: "text-[14px]", tag: "text-[9px]" },
    md: { mark: "h-8 w-8", name: "text-[15px]", tag: "text-[9.5px]" },
    lg: { mark: "h-14 w-14", name: "text-[24px]", tag: "text-[11px]" },
  }[size]
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <LeadMagnetMark className={`${s.mark} shrink-0`} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className={`${s.name} truncate font-semibold tracking-tight text-slate-900`}>Lead Magnet</span>
        <span className={`${s.tag} mt-1 font-bold uppercase tracking-[0.22em] text-violet-600`}>CRM</span>
      </span>
    </span>
  )
}

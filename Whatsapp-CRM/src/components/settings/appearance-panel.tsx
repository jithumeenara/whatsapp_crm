"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type ColorScheme = "light" | "dark" | "system";

const STORAGE_KEY = "wacrm.colorScheme";

const OPTIONS: { id: ColorScheme; label: string; description: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", description: "Bright background, dark text.", icon: Sun },
  { id: "dark", label: "Dark", description: "Dark background, light text.", icon: Moon },
  { id: "system", label: "System", description: "Match your device's setting automatically.", icon: Monitor },
];

function readInitial(): ColorScheme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts
  }
  return "system";
}

/**
 * Appearance — the standard Light/Dark/System pattern every app uses,
 * replacing the previous 6-swatch accent-color picker.
 *
 * Deliberately NOT wired to real colors yet (by explicit decision) — this
 * just saves the preference so a later pass can apply it everywhere at
 * once. Worth knowing for that later pass: 5 of the app's existing 6
 * accent themes (see lib/themes.ts) are already built as full dark
 * palettes, so wiring "Dark" up for real is less work than starting from
 * scratch.
 */
export function AppearancePanel() {
  const [scheme, setScheme] = useState<ColorScheme>(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, scheme);
    } catch {
      // same private-browsing edge case as above
    }
  }, [scheme]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Appearance</h2>
        <p className="mt-1 text-sm text-slate-500">
          Choose how the app looks. Saved to this device.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = scheme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setScheme(opt.id)}
              aria-pressed={isActive}
              className={cn(
                "flex flex-col gap-3 rounded-xl border bg-white p-4 text-left transition-colors",
                isActive
                  ? "border-[#5B6CF9]/60 ring-2 ring-[#5B6CF9]/30"
                  : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg",
                  isActive ? "bg-[#5B6CF9]/10" : "bg-slate-100",
                )}>
                  <Icon className={cn("h-4.5 w-4.5", isActive ? "text-[#5B6CF9]" : "text-slate-500")} />
                </span>
                {isActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#5B6CF9]/10 px-2 py-0.5 text-[11px] font-medium text-[#5B6CF9]">
                    <Check className="h-3 w-3" />
                    Active
                  </span>
                )}
              </div>
              <div>
                <div className="text-[13.5px] font-semibold text-slate-800">{opt.label}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{opt.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[12px] text-slate-400">
        Dark mode is on the way — your preference is saved now and will apply automatically the moment it&apos;s ready.
      </p>
    </section>
  );
}

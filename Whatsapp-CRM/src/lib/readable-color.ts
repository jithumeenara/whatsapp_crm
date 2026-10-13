// A tag's own colour (amber, emerald, yellow…) is chosen to look bright, so as
// text on white or on its own light tint it reads at 2–3:1. Mixing it with
// near-black keeps the hue recognisable and lifts it past 4.5:1 for any
// colour a user can pick. Use it for text only; backgrounds keep the real colour.
export function readableTextColor(color: string | null | undefined): string | undefined {
  if (!color) return undefined
  return `color-mix(in srgb, ${color} 55%, #0f172a)`
}

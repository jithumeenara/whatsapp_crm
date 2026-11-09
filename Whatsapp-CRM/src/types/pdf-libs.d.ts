// Neither fontkit nor bidi-js ships TypeScript types. Only what the report PDF
// writer (src/lib/reports/pdf) uses is described here.

declare module 'fontkit' {
  export interface Font {
    ascent: number
    unitsPerEm: number
  }
  export function create(data: Buffer | Uint8Array): Font
}

declare module 'bidi-js' {
  interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> }
  }
  export default function bidiFactory(): Bidi
}

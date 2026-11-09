# Fonts for the report PDF

Noto Sans (Latin), Noto Sans Malayalam, Devanagari, Tamil, Telugu, Kannada,
Bengali and Arabic, regular and bold, from https://github.com/notofonts.
Licensed under the SIL Open Font License 1.1 (see OFL.txt).

The PDF writer opens a script's font only when text in that script occurs.
Add a language by adding its font here, naming it in
src/lib/reports/pdf/fonts.ts and writing its dictionary in
src/lib/reports/i18n/.

# Share image generator

`npm run og:image` renders `public/og-image.png` (1200×630) with `generate_og_image.py --default --verify-qr`. Commit the PNG after a change. See docs/seo.md.

Third-party files:

- `assets/en_badge_web_generic.png`: Google's official "Get it on Google Play" badge, from https://play.google.com/intl/en_us/badges/. It is used unmodified, scaled uniformly, with its built-in clear space, as Google's badge guidelines require. Google Play and the Google Play logo are trademarks of Google LLC.
- `fonts/Inter-VariableFont_opsz,wght.ttf`: Inter, Copyright 2020 The Inter Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt`).

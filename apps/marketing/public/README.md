# Marketing site assets

This site ships with **inline SVG** for the logo, globe, and icons (no external image
dependencies — fast, offline-buildable). Drop real assets here when ready:

| File to add (this folder)     | Used for                                   | Notes |
|-------------------------------|--------------------------------------------|-------|
| `og-image.png` (1200×630)     | Social share preview (OpenGraph/Twitter)   | Then set it in `src/app/layout.tsx` `openGraph.images` + `twitter.images`. |
| `logo.svg` / `logo.png`       | A finished brand logo (replaces the inline mark in `src/components/Logo.tsx`) | Optional — the inline mark is production-ready. |
| `hero/*.jpg`, `team/*.jpg`    | Real photography for a future work-showcase / about section | Compress first; reference from `src/content/site.ts` `showcase`. |
| `showreel.mp4` or a video URL | Optional hero/explainer video              | Set `videoUrl` in `src/content/site.ts` (a section renders only when present). |

## Editable content
All marketing copy, **services, check prices (single/bundle), stats, testimonials, and FAQ**
live in **`src/content/site.ts`** — edit there (no CMS). Figures and testimonials are
**placeholders**; replace with real, permissioned values.

## Required environment (see `.env.example`)
- `NEXT_PUBLIC_WHATSAPP_NUMBER` — your WhatsApp number (digits only, international).
- `NEXT_PUBLIC_SITE_URL` — the public URL (default `https://xfactoras.com`).
- `NEXT_PUBLIC_CONTACT_EMAIL` — public contact email.
- `API_URL` — **server-only**; the private Business OS API base the quote BFF forwards to.

The "Get a Quote" form posts to `/api/quote` (this app's server route), which forwards to the
API's `POST /public/quote` — creating a **lead + a draft** in the system (never priced).

/** Public site config. NEXT_PUBLIC_* values are exposed to the browser. */

/** The canonical public site URL (used for metadata/OG/sitemap). */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://xfactoras.com";

/** WhatsApp number in international format, digits only (placeholder — edit me). */
export const WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "8801000000000").replace(/[^0-9]/g, "");

/** Build a wa.me deep link with an optional prefilled message. */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** Contact email (placeholder — edit me). */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@xfactoras.com";

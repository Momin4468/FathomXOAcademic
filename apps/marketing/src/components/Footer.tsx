import Link from "next/link";
import { brand, footer, nav } from "@/content/site";
import { CONTACT_EMAIL, whatsappLink } from "@/lib/config";
import { Logo } from "./Logo";
import { Container } from "./ui";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-ink-950 hairline">
      <Container className="pt-14 pb-24 sm:pb-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">{brand.subline}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Explore</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              {nav.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="transition hover:text-white">{n.label}</a>
                </li>
              ))}
              <li>
                <Link href="/get-a-quote" className="transition hover:text-white">Get a Quote</Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Contact</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li>
                <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="transition hover:text-white">
                  WhatsApp us
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className="transition hover:text-white">{CONTACT_EMAIL}</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 hairline sm:flex-row">
          <p>© {new Date().getFullYear()} {brand.name}. All rights reserved.</p>
          <p>
            <a href={footer.developedByUrl} target="_blank" rel="noopener noreferrer" className="text-slate-400 transition hover:text-gold-300">
              {footer.developedBy}
            </a>
          </p>
        </div>
      </Container>
    </footer>
  );
}

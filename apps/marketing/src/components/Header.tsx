import Link from "next/link";
import { nav } from "@/content/site";
import { whatsappLink } from "@/lib/config";
import { Logo } from "./Logo";
import { Button, Container } from "./ui";

/** Sticky top navigation. Mobile shows the logo + the two CTAs (nav links are
 *  reachable by scrolling / the footer); desktop shows the full nav. */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-900/80 backdrop-blur-md hairline">
      <Container className="flex items-center justify-between gap-4 py-3">
        <Link href="/" aria-label="X-Factor Academic Solutions — home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="text-sm text-slate-300 transition hover:text-white">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" href={whatsappLink("Hi! I'd like to ask about your academic services.")} external className="hidden px-4 sm:inline-flex">
            WhatsApp
          </Button>
          <Button variant="gold" href="/get-a-quote" className="px-5">
            Get a Quote
          </Button>
        </div>
      </Container>
    </header>
  );
}

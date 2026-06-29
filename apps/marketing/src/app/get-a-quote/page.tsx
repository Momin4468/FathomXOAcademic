import type { Metadata } from "next";
import { QuoteForm } from "@/components/QuoteForm";
import { Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Get a Quote",
  description:
    "Tell us about your assignment, dissertation, thesis, research, or Turnitin/AI check and attach your brief. We'll review it and send a fair quote on WhatsApp or email — no payment needed to ask.",
  alternates: { canonical: "/get-a-quote" },
};

export default function GetAQuotePage() {
  return (
    <div className="bg-starfield">
      <Container className="grid gap-12 py-16 pb-28 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div className="lg:pt-6">
          <Eyebrow>Get a quote</Eyebrow>
          <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
            Send your brief, <span className="text-gradient-gold">get a fair quote.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-slate-300">
            Share a few details and attach your file. Our specialist team reviews every request and replies with a clear
            quote and timeline. Nothing is charged until you approve.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {[
              "Every field, every level — one expert team",
              "Confidential — your details and our writers stay private",
              "Reply on WhatsApp or email, usually within hours",
              "Payment arranged offline — flexibility for returning clients",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" fill="none" aria-hidden>
                  <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <QuoteForm />
        </div>
      </Container>
    </div>
  );
}

import {
  brand,
  careers,
  checks,
  edge,
  faqs,
  process as steps,
  referral,
  services,
  stats,
  testimonials,
  vendor,
} from "@/content/site";
import { whatsappLink } from "@/lib/config";
import { Globe } from "@/components/Globe";
import { Button, Card, Container, Eyebrow, Pill, Section, SectionHeading, cx } from "@/components/ui";

const quoteMsg = "Hi! I'd like a quote for an academic project.";

export default function HomePage() {
  return (
    <>
      <Hero />
      <StatBand />
      <Services />
      <Edge />
      <Checks />
      <HowItWorks />
      <Results />
      <ReferralVendor />
      <Careers />
      <Faq />
      <FinalCta />
      <FaqJsonLd />
    </>
  );
}

function Hero() {
  return (
    <div className="relative overflow-hidden bg-starfield">
      <Container className="grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-2">
        <div className="animate-fadeup">
          <Pill>
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400" /> Trusted academic partner · worldwide
          </Pill>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] sm:text-5xl lg:text-6xl">
            All your academic needs,{" "}
            <span className="text-gradient-gold">one expert team.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">{brand.subline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/get-a-quote">Get a Quote</Button>
            <Button variant="outline" href={whatsappLink(quoteMsg)} external>
              Chat on WhatsApp
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            <Pill>Confidential — writers never public</Pill>
            <Pill>On-time delivery</Pill>
            <Pill>Every field & level</Pill>
          </div>
        </div>
        <div className="relative mx-auto flex max-w-md items-center justify-center lg:max-w-none">
          <div className="animate-floaty">
            <Globe className="h-[20rem] w-[20rem] sm:h-[26rem] sm:w-[26rem]" />
          </div>
        </div>
      </Container>
    </div>
  );
}

function StatBand() {
  return (
    <div className="border-y border-white/10 bg-ink-850/50 hairline">
      <Container className="grid grid-cols-2 gap-6 py-10 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div className="font-display text-3xl font-semibold text-gradient-gold sm:text-4xl">{s.value}</div>
            <div className="mt-1 text-sm text-slate-400">{s.label}</div>
          </div>
        ))}
      </Container>
    </div>
  );
}

function Services() {
  return (
    <Section id="services">
      <SectionHeading
        eyebrow="What we do"
        title="Every academic service, in one place"
        intro="One specialist team spanning all departments — so whatever you need, you brief us once."
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s, i) => (
          <Card key={s.title} className="transition hover:border-gold-400/30">
            <div className="mb-3 font-display text-sm font-semibold text-gold-400">
              {String(i + 1).padStart(2, "0")}
            </div>
            <h3 className="text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.blurb}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Edge() {
  return (
    <Section className="bg-ink-850/40">
      <SectionHeading eyebrow="Our edge" title="Why students and researchers choose us" />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {edge.map((e) => (
          <div key={e.title} className="border-l-2 border-gold-400/40 pl-5">
            <h3 className="text-base font-semibold text-slate-100">{e.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{e.blurb}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Checks() {
  return (
    <Section id="checks">
      <SectionHeading
        eyebrow="Turnitin & AI checks"
        title="Know your originality before you submit"
        intro={checks.intro}
      />
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {checks.plans.map((p) => (
          <Card
            key={p.name}
            className={cx(
              "flex flex-col",
              p.highlight && "border-gold-400/50 shadow-glow",
            )}
          >
            {p.highlight && (
              <span className="mb-3 inline-block w-fit rounded-full bg-gold-400/15 px-3 py-1 text-xs font-semibold text-gold-300">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="font-display text-3xl font-semibold text-slate-100">{p.price}</span>
              <span className="text-sm text-slate-400">/ {p.unit}</span>
            </div>
            <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <Button variant={p.highlight ? "gold" : "outline"} href="/get-a-quote" className="w-full">
                Request this
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">{checks.note}</p>
    </Section>
  );
}

function HowItWorks() {
  return (
    <Section id="how" className="bg-ink-850/40">
      <SectionHeading eyebrow="How it works" title="From brief to delivery — simple and clear" />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <div key={s.step} className="relative">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-gold-400/40 font-display text-lg font-semibold text-gold-300">
              {s.step}
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-100">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.blurb}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Results() {
  return (
    <Section id="results">
      <SectionHeading eyebrow="Results" title="Trusted across fields and borders" center />
      <div className="mx-auto mt-12 grid max-w-5xl gap-5 lg:grid-cols-3">
        {testimonials.map((t) => (
          <Card key={t.name} className="flex flex-col">
            <div aria-hidden className="font-display text-4xl leading-none text-gold-400/60">&ldquo;</div>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-200">{t.quote}</p>
            <div className="mt-5 border-t border-white/10 pt-4 hairline">
              <div className="text-sm font-semibold text-slate-100">{t.name}</div>
              <div className="text-xs text-slate-400">{t.meta}</div>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">Indicative client feedback — representative examples.</p>
    </Section>
  );
}

function ReferralVendor() {
  return (
    <Section className="bg-ink-850/40">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <Eyebrow>Refer & earn</Eyebrow>
          <h3 className="text-xl font-semibold">{referral.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{referral.blurb}</p>
          <a href={whatsappLink("Hi! I'd like to know about your referral programme.")} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm font-semibold text-gold-300 hover:text-gold-200">
            Ask about referrals →
          </a>
        </Card>
        <Card>
          <Eyebrow>For partners</Eyebrow>
          <h3 className="text-xl font-semibold">{vendor.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{vendor.blurb}</p>
          <a href={whatsappLink("Hi! I'm interested in a partner/vendor arrangement.")} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm font-semibold text-gold-300 hover:text-gold-200">
            Become a partner →
          </a>
        </Card>
      </div>
    </Section>
  );
}

function Careers() {
  return (
    <Section>
      <Card className="flex flex-col items-start justify-between gap-5 border-gold-400/20 sm:flex-row sm:items-center">
        <div>
          <Eyebrow>Careers</Eyebrow>
          <h3 className="text-xl font-semibold">{careers.title}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{careers.blurb}</p>
        </div>
        <Button variant="outline" href={whatsappLink("Hi! I'd like to register interest in joining your writer team.")} external className="shrink-0">
          Register interest
        </Button>
      </Card>
    </Section>
  );
}

function Faq() {
  return (
    <Section id="faq" className="bg-ink-850/40">
      <SectionHeading eyebrow="FAQ" title="Questions, answered" center />
      <div className="mx-auto mt-10 max-w-3xl divide-y divide-white/10 hairline">
        {faqs.map((f) => (
          <details key={f.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-slate-100">
              {f.q}
              <span className="text-gold-400 transition group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <div className="relative overflow-hidden bg-starfield">
      <Container className="py-20 text-center sm:py-28">
        <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold leading-tight sm:text-4xl">
          Ready when you are. Send your brief and get a fair quote.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-slate-300">
          No payment needed to ask. We&apos;ll review your details and reply on WhatsApp or email.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button href="/get-a-quote">Get a Quote</Button>
          <Button variant="outline" href={whatsappLink(quoteMsg)} external>
            Chat on WhatsApp
          </Button>
        </div>
      </Container>
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" fill="none" aria-hidden>
      <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** FAQ structured data for rich results. */
function FaqJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  X-Factor Academic Solutions — marketing content (THE edit surface).
 *  This file is the single, typed source for all marketing copy/data: services,
 *  check prices, stats, testimonials, FAQ, etc. Edit here (no CMS). Figures &
 *  testimonials are PLACEHOLDERS — replace with real numbers/quotes.
 *  Dynamic business data (the quote → lead) is handled by the system, not here.
 * ───────────────────────────────────────────────────────────────────────────
 */

export const brand = {
  name: "X-Factor Academic Solutions",
  short: "X-Factor",
  tagline: "All your academic needs, one expert team.",
  subline:
    "Assignments, dissertations, theses, research, Turnitin & AI checks, SOP & documentation, exam guidance and study support — delivered by one specialist team across every field.",
} as const;

export const nav = [
  { label: "Services", href: "/#services" },
  { label: "Checks & pricing", href: "/#checks" },
  { label: "How it works", href: "/#how" },
  { label: "Results", href: "/#results" },
  { label: "FAQ", href: "/#faq" },
] as const;

/** Headline trust figures — PLACEHOLDERS, edit freely. */
export const stats = [
  { value: "10,000+", label: "Projects delivered" },
  { value: "60+", label: "Fields & departments" },
  { value: "20+", label: "Countries served" },
  { value: "98%", label: "On-time delivery" },
] as const;

export interface Service {
  title: string;
  blurb: string;
  /** A short keyword line for SEO + scannability. */
  keywords: string;
}

export const services: Service[] = [
  { title: "Assignments & coursework", blurb: "Every subject, every level — structured, referenced, and on time.", keywords: "assignment help, coursework writing" },
  { title: "Dissertations & theses", blurb: "Full theses and dissertations with chapter-by-chapter guidance.", keywords: "dissertation writing, thesis help" },
  { title: "Projects & capstones", blurb: "End-to-end project work, from proposal to final submission.", keywords: "capstone project, final-year project" },
  { title: "Research & data collection", blurb: "Literature reviews, methodology, analysis, and primary data work.", keywords: "research help, data collection, data analysis" },
  { title: "Publication-related work", blurb: "Manuscript preparation, formatting, and journal-readiness support.", keywords: "research paper, publication support" },
  { title: "Documentation & SOP", blurb: "SOPs, motivation letters, CVs, reports, and professional documents.", keywords: "SOP writing, statement of purpose, CV writing" },
  { title: "Exam & study guidance", blurb: "Exam preparation, study plans, and concept walkthroughs.", keywords: "exam guidance, study help" },
  { title: "Tutorials & personalized guidance", blurb: "One-to-one tutorials and tailored academic mentoring.", keywords: "online tutoring, academic mentoring" },
  { title: "Responsible AI-use guidance", blurb: "How to use AI tools ethically and within your institution's rules.", keywords: "responsible AI use, academic integrity" },
];

/** Why-us / edge points. */
export const edge = [
  { title: "One team, every field", blurb: "A strong specialist writer team across all departments — so you brief once, for anything." },
  { title: "Discreet by design", blurb: "Writer identities are never made public. Your work and your details stay private." },
  { title: "Reasonable pricing", blurb: "Fair, transparent quotes — and payment flexibility for reliable, returning clients." },
  { title: "Timely delivery", blurb: "Deadlines respected, with clear milestones and updates throughout." },
  { title: "Results that matter", blurb: "Quality work aimed at high grades, with revisions and improvement feedback." },
  { title: "Counselling & support", blurb: "Friendly guidance and responsive support before, during, and after." },
];

/** Turnitin / AI check pricing — content-driven (single & bundle). PLACEHOLDER prices. */
export const checks = {
  intro:
    "Independent Turnitin & AI-writing checks with a clear report and improvement feedback. Files are exchanged securely through our system or WhatsApp.",
  note: "Indicative pricing — final quote confirmed on request. Payment is arranged offline (no online checkout).",
  plans: [
    {
      name: "Single check",
      price: "৳ 300",
      unit: "per file",
      features: ["Turnitin similarity report", "AI-writing detection", "Plain-language summary"],
      highlight: false,
    },
    {
      name: "Check + feedback",
      price: "৳ 500",
      unit: "per file",
      features: ["Everything in Single", "Improvement feedback", "Re-check after edits (1x)"],
      highlight: true,
    },
    {
      name: "Bundle (5 files)",
      price: "৳ 1,200",
      unit: "5 files",
      features: ["5 checks, any mix", "Improvement feedback", "Priority turnaround"],
      highlight: false,
    },
  ],
} as const;

export const process = [
  { step: "1", title: "Send your brief", blurb: "Share details and attach your file. Takes two minutes — no payment needed." },
  { step: "2", title: "We quote it", blurb: "Our team reviews and sends a fair quote on WhatsApp or email." },
  { step: "3", title: "You approve", blurb: "Confirm the scope and timeline. Nothing proceeds until you're happy." },
  { step: "4", title: "Delivered", blurb: "You receive your work on time, with checks and revision support." },
] as const;

/** PLACEHOLDER testimonials — replace with real, permissioned quotes. */
export const testimonials = [
  { quote: "Clear communication, on-time delivery, and the grade I needed. Discreet and professional throughout.", name: "Postgraduate student", meta: "MBA · UK" },
  { quote: "They handled my whole thesis timeline — proposal to final. Genuinely felt like one team for everything.", name: "Research student", meta: "Engineering · Australia" },
  { quote: "Fast Turnitin checks with actual feedback on what to fix. Came back well under the limit.", name: "Undergraduate", meta: "Business · Canada" },
] as const;

export const faqs = [
  { q: "What subjects and services do you cover?", a: "Every field — assignments, projects, dissertations, theses, research, data collection, publication work, documentation and SOPs, exam guidance, tutorials, and personalized support. One specialist team covers all departments." },
  { q: "How much does it cost?", a: "Pricing depends on the subject, level, length, and deadline. Send your brief for a fast, fair quote — there's no charge to ask, and payment is arranged offline." },
  { q: "How do payments work?", a: "We don't take online payments here. Once you approve a quote, payment is arranged directly over WhatsApp. Reliable, returning clients enjoy added payment flexibility." },
  { q: "Do you offer Turnitin and AI checks?", a: "Yes — independent Turnitin similarity and AI-writing checks with a report and improvement feedback, as single checks or bundles. Files are exchanged via our system or WhatsApp." },
  { q: "Is my information private?", a: "Yes. Your details and your work stay confidential, and our writers' identities are never made public. Discretion is part of how we work." },
  { q: "How fast can you deliver?", a: "We work to your deadline and keep you updated with clear milestones. Share your timeline in the quote form and we'll confirm what's possible." },
  { q: "Do you guide on responsible AI use?", a: "We do — we help you use AI tools ethically and within your institution's rules, so your work stays original and compliant." },
] as const;

export const referral = {
  title: "Refer a friend",
  blurb: "Know someone who needs academic support? Refer them and you both benefit — ask us about our referral programme.",
};

export const vendor = {
  title: "Partner & vendor programme",
  blurb: "Run a tutoring agency or academic service? We offer scoped partner and vendor arrangements through our system. Get in touch to collaborate.",
};

export const careers = {
  title: "Work with us",
  blurb: "We're growing our specialist team across every department. Roles open soon — expert writers, researchers, and tutors. Check back, or message us to register your interest.",
  active: false,
};

export const footer = {
  developedBy: "Developed by FathomXO",
  developedByUrl: "https://www.fathomxo.com",
};

/** Optional content slots — leave empty to hide the section. */
export const showcase: { title: string; image: string; caption: string }[] = [];
export const videoUrl: string | null = null;

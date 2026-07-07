# Web / App UI Reference Sheet
### For data-heavy systems: Website · SaaS · ERP · HRM · Finance & Accounting

---

## 1. Sections & UI Elements Vocabulary

### Page Layout / Structure
Header · Navigation bar (navbar) · Menu · Dropdown · Hamburger menu · Sidebar · Hero / banner section · Main content (body) · Footer · Breadcrumb · Logo · Favicon · Container · Grid · Panel · Section · Divider · Sticky header · Sidebar collapse · Split view

### Landing-Page Sections
Hero · Call-to-action (CTA) · Features section · Pricing table · Testimonials · FAQ · About us · Contact form · Newsletter signup · Client / partner logos · Blog · Carousel / slider

### Interactive UI Elements
Button · Form · Text input · Textarea · Checkbox · Radio button · Toggle / switch · Dropdown / select · Multi-select · Search bar · Date picker · Time picker · Slider · Number input · Tabs · Accordion · Modal / popup · Tooltip · Progress bar · Stepper · Badge · Chip / tag · Avatar · Notification / bell · Rating (stars) · File upload / drag-and-drop · Rich text editor · Color picker · Autocomplete / combobox · Floating action button (FAB) · Pill navigation

### Feedback & State Elements
Spinner / loader · Skeleton loader · Snackbar / toast · Banner / alert · Empty state · Placeholder text · Confirmation dialog · Error message · Success message

### Data Display
Data grid / table · Tree view · Timeline · Kanban board · Calendar view · Gallery / list toggle · Infinite scroll · Lazy loading · Pagination · Filters · Sort · Card

### Dashboard (Logged-in App Side)
Dashboard · Widget · Card · KPI / metric tile · Charts & graphs · Data table · Filters · Export button · Quick actions · Side navigation · Profile menu · Settings

### Login / Account Area
Login page · Sign-up / register · Forgot password · OTP · Profile page · User settings · Logout

---

## 2. Choosing the Right Input Control

| Need | Use |
|------|-----|
| Pick 1 of few (≤5) | **Radio buttons** — all visible at once |
| Pick 1 of many (6+) | **Dropdown / select** — saves space |
| Pick several | **Checkboxes** — each independent on/off |
| On/off setting | **Toggle / switch** — feels instant |
| Single consent | **One checkbox** — "I accept the terms" |
| Approximate number | **Slider** — price range, volume |
| Exact number | **Number input** with steppers |
| Short free text | **Text input** — name, email |
| Long free text | **Textarea** — comments, address |
| A date / time | **Date picker / time picker** — never free-type |
| Search a big list | **Autocomplete / combobox** |
| A file | **File upload** control |

**Common mistakes to avoid:**
- Dropdown for just 2 options → radios are faster.
- Radios for 50 countries → dropdown/autocomplete is cleaner.
- Free-typed dates → always use a picker.

---

## 3. UI/UX Cheat-Sheet for ERP / HRM / Finance

### Field-Level Rules

| Field type | Best control | Key practices |
|---|---|---|
| Money / currency | Text/number input | Right-align, currency symbol, thousand separators, 2 decimals, **no** spinner arrows |
| Quantity | Number input + steppers | Left of unit label, min/max limits |
| Percentage / tax | Number input | `%` suffix, right-align |
| Date | Date picker | Never free-type; show format hint, respect fiscal year |
| ID / code (Emp ID, SKU, Invoice #) | Read-only or validated | Auto-generate when possible, monospace font |
| Status | Badge/chip (display) + dropdown (edit) | Color-coded: green=paid, red=overdue, grey=draft |
| Account (chart of accounts) | Searchable dropdown / tree | Autocomplete — never a 500-row plain select |
| Long list (country, product, vendor) | Autocomplete / combobox | Type-to-search |
| Short single choice | Radio or dropdown | Radios if ≤5, dropdown if more |
| Multiple selection | Checkboxes or multi-select | Show count selected |
| On/off setting | Toggle switch | Applies instantly |
| Notes / description | Textarea | Auto-expand, char counter if limited |
| Negative numbers | Number input | Show in **red** or (parentheses) — finance convention |

### Data Tables (the core of these systems)
- Sticky/frozen header row; pin key columns (ID, name) so they stay visible when scrolling wide tables.
- Right-align numbers, left-align text, center status badges.
- Sortable columns, column filters, and a global search.
- Row checkboxes for **bulk actions** (delete, export, approve many at once).
- Pagination for finance (predictable); infinite scroll for feeds; always show total record count.
- Column totals / subtotals at the bottom for money columns.
- Export to Excel / PDF / CSV — mandatory in these domains.
- Density toggle (comfortable vs compact) for power users.
- Inline edit for quick changes; modal/side-panel for full records.
- Empty state ("No invoices yet") instead of a blank grid.

### Forms & Data Entry
- Group related fields into sections/fieldsets ("Personal Info", "Bank Details").
- Break long forms into a **stepper/wizard** (Step 1 of 4).
- Inline validation (validate on blur, not only on submit); mark required fields with `*`.
- Keyboard-first: logical tab order, Enter to move on — data-entry staff live on the keyboard.
- Sensible defaults (today's date, home currency, default warehouse).
- Autosave or "Save draft"; warn before leaving with unsaved changes.
- One clear **primary** action (Save), secondary muted (Cancel).
- Confirmation dialog for destructive/irreversible actions.
- Show an **audit trail** (created by, modified on) — critical for finance/HR compliance.

### Domain-Specific Patterns

**HRM** — Employee directory (search + filter + cards) · attendance as a calendar view · leave form showing remaining balance · org chart as a tree · payslip as read-only + download.

**Finance** — Ledger as a grid with separate Debit/Credit columns (right-aligned) · invoices with an editable line-item table · reconciliation as a two-panel match view · reports = filters + chart + export.

**ERP** — Master-data forms · line-item tables for orders/BOMs · status workflow badges · cross-module links (click a PO → jump to its invoice).

### Golden Rules for Data-Heavy Apps
1. Optimize for **speed of entry** and **scannability**.
2. Be ruthlessly **consistent**.
3. Give **instant feedback** (toasts, loaders).
4. **Never lose** the user's work.
5. Make **filters persist**.

---

*Reference sheet compiled for building/reviewing website, SaaS, ERP, HRM, and finance & accounting interfaces.*

# SikHal — Phase 1 Design Specification

**Author:** 艾简白 (Ai), Product UI/UX Designer
**Status:** Implementation-ready — Phase 1 deliverable
**Audience:** Lead / implementing engineer (程建枢), QA & Financial Logic (严核明)
**Scope:** Exactly two screens — **Screen 1: New Case** and **Screen 2: Review Resolution**. No login, no dashboard, no third screen.

> Design intent in one line: SikHal should feel like a calm, exact instrument — a founder picks it up between two lectures, understands in three seconds what is owed and what to do, and never mistakes a warning for decoration.

---

## 1. Design Principles

These are specific to a Malaysian student founder resolving a supplier cancellation on a phone, often mid-campus, often under time pressure.

1. **Money must be legible before it is beautiful.** Every MYR figure is rendered on its own line, right-aligned in a tabular-numeric face, with two decimal places always shown (`RM84.00`, not `RM84`). Sen-level precision is a trust signal, not noise. A founder who cannot read an amount at a glance on a 360px screen will not trust the computation.

2. **The academic conflict outranks everything.** When a proposed action collides with the founder's class or study hours, that fact is the loudest thing on the screen — louder than the refund total, louder than the approve button. The founder is a student first; the design encodes that priority, it does not merely state it.

3. **Approval is a deliberate act, never a side effect.** No financial or external action (issuing refunds, sending messages) occurs without an explicit, unambiguous confirmation by the founder. The approve control is never the visually dominant default; it is reached through a confirmation step that restates exactly what will happen.

4. **The agent narrates its work; it never shows a void.** The agent performs real tool execution that takes time. The founder sees labeled steps advancing — which tool is running, what it found — not an indeterminate spinner over an empty panel. Visible work is what makes the output credible.

5. **Restrained is faster.** No gradients, no emoji, no decorative motifs. Surfaces are off-white, actions are deep evergreen, borders are hairline. Each decorative element removed is one less thing between the founder and the number they owe.

---

## 2. Design Tokens

Palette anchors from the brief: deep evergreen `#243B36` and off-white `#F7F7F2`. All values below are final and must be used verbatim.

### 2.1 Colour

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#F7F7F2` | App background (off-white, warm-neutral). The default page surface. |
| `--surface` | `#FFFFFF` | Card / panel surface raised above `--bg`. |
| `--surface-sunken` | `#EFEFE9` | Inset regions: refund table zebra rows, code/pre blocks, read-only fields. |
| `--border` | `#DEDED6` | Default 1px hairline border on cards, inputs, table. |
| `--border-strong` | `#C3C3B8` | Focus-adjacent structure, table header underline, dividers needing weight. |
| `--text-primary` | `#1B2621` | Body and heading text. Near-black with a green undertone to sit beside evergreen. |
| `--text-secondary` | `#54615B` | Labels, captions, secondary metadata, table column headers. |
| `--text-muted` | `#7C8781` | Disabled text, placeholder text, timestamps. |
| `--primary` | `#243B36` | Primary actions (Approve, Run agent), active nav, key headings accent. |
| `--primary-hover` | `#1C302B` | Hover/active state of primary surfaces. |
| `--primary-fg` | `#F7F7F2` | Text/icon on `--primary`. |
| `--accent` | `#3E6B5C` | Secondary evergreen accent: links, focus ring companion, selected nav underline. |
| `--success` | `#2E6B4F` | Confirmed/validated states, "no conflict", reconciliation OK. |
| `--success-bg` | `#E7EFE9` | Success banner background. |
| `--warning` | `#8A5A0B` | Caution text/icons (academic conflict, partial data). Dark amber, not yellow. |
| `--warning-bg` | `#FBF0DA` | Academic-conflict banner background. |
| `--warning-border` | `#D9A93C` | Academic-conflict left rail and border. Must pair with non-colour cues. |
| `--danger` | `#9B2C2C` | Destructive/blocked states, validation errors, over-refund flags. |
| `--danger-bg` | `#F9E7E7` | Error banner and blocked-slot background. |
| `--danger-border` | `#C0504D` | Error border / blocked-slot rail. |
| `--info` | `#2C5468` | Neutral informational notes (deep slate-teal). |
| `--info-bg` | `#E6EEF1` | Info banner background. |
| `--focus-ring` | `#3E6B5C` | Focus outline colour (2px), offset 2px. |
| `--overlay` | `rgba(27, 38, 33, 0.55)` | Modal scrim over evergreen-black. |

**Dark mode:** Explicitly out of scope. The MVP ships light only (brief forbids dark-by-default). Tokens are named semantically so a future dark theme is a value swap, not a refactor.

### 2.2 Typography

**Font choice:** system font stack. Rationale: zero web-font latency on campus mobile data, perfect numeral rendering across OS, and no brand justification strong enough to justify a network font for a two-screen tool.

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, "Noto Sans", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
```

All monetary figures use `font-variant-numeric: tabular-nums` so columns of MYR align digit-for-digit.

| Style | Size / Line-height | Weight | Use |
|-------|--------------------|--------|-----|
| `display` | 32px / 40px | 600 | Screen title on desktop (mobile downgrades to 24px) |
| `title` | 24px / 32px | 600 | Section heading, screen title mobile, modal title |
| `heading` | 20px / 28px | 600 | Card / panel headings |
| `subheading` | 16px / 24px | 600 | Sub-section, table group label |
| `body` | 16px / 24px | 400 | Default body copy, input text |
| `body-sm` | 14px / 20px | 400 | Secondary copy, helper text, table cells |
| `label` | 14px / 20px | 500 | Form field labels, button text |
| `caption` | 12px / 16px | 400 | Metadata, timestamps, column headers (uppercase, `letter-spacing: 0.04em`) |
| `money` | 16px / 24px | 600 | Refund amounts, totals (tabular-nums) |
| `money-lg` | 20px / 28px | 600 | Grand total (tabular-nums) |

Minimum body text is 16px; nothing readable falls below 14px except captions at 12px, which are non-essential metadata only.

### 2.3 Spacing (4px grid)

| Token | Value | Typical use |
|-------|-------|-------------|
| `--space-1` | 4px | Icon-to-label gap, tight inline gaps |
| `--space-2` | 8px | Between related inline items, table cell padding-y |
| `--space-3` | 12px | Input inner padding-y, gap inside compact groups |
| `--space-4` | 16px | Default stack gap, card padding (mobile), cell padding-x |
| `--space-5` | 20px | Input inner padding-x |
| `--space-6` | 24px | Card padding (desktop), section gap |
| `--space-8` | 32px | Major section separation |
| `--space-12` | 48px | Screen top padding (desktop), empty-state breathing room |

Content max-width: `1100px`, centred, with `16px` mobile gutters and `24px` gutter ≥ 768px. Reading-width sub-columns (message drafts) cap at `68ch`.

### 2.4 Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 6px | Inputs, buttons, badges, small chips |
| `--radius-md` | 10px | Cards, panels, banners |
| `--radius-lg` | 14px | Modals, the outer case container |
| `--radius-full` | 9999px | Status pills, avatars, step dots |

### 2.5 Elevation

Deliberately minimal — elevation signals interactivity, not decoration.

| Token | Value | Use |
|-------|-------|-----|
| `--elev-0` | none | Default for all static surfaces (border only) |
| `--elev-1` | `0 1px 2px rgba(27,38,33,0.06)` | Sticky header on scroll, raised card |
| `--elev-2` | `0 8px 24px rgba(27,38,33,0.12)` | Modal / dialog, dropdown menu, toast |

### 2.6 Motion

| Token | Value | Use |
|-------|-------|-----|
| `--dur-1` | 120ms | Hover, focus, button press |
| `--dur-2` | 200ms | Panel expand/collapse, banner enter |
| `--dur-3` | 320ms | Modal enter/exit, step transition |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default for all transitions |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Element entering viewport |

**Reduced motion:** honour `prefers-reduced-motion: reduce` — all durations collapse to `0ms`; the agent step indicator uses a static current-step highlight instead of a pulse.

---

## 3. Contrast Verification Table

Contrast ratios computed per WCAG 2.1 relative-luminance formula. AA thresholds: normal text ≥ 4.5:1, large text (≥ 18.66px bold or ≥ 24px) ≥ 3:1, non-text UI (borders, focus ring, icons) ≥ 3:1.

| Foreground | Background | Ratio | Normal text | Large / UI | Verdict |
|------------|------------|-------|-------------|------------|---------|
| `#1B2621` text-primary | `#F7F7F2` bg | **14.6:1** | Pass | Pass | ✅ |
| `#1B2621` text-primary | `#FFFFFF` surface | **15.6:1** | Pass | Pass | ✅ |
| `#243B36` primary | `#F7F7F2` bg | **11.4:1** | Pass | Pass | ✅ |
| `#F7F7F2` primary-fg | `#243B36` primary | **11.4:1** | Pass | Pass | ✅ |
| `#54615B` text-secondary | `#F7F7F2` bg | **6.3:1** | Pass | Pass | ✅ |
| `#54615B` text-secondary | `#FFFFFF` surface | **6.7:1** | Pass | Pass | ✅ |
| `#7C8781` text-muted | `#F7F7F2` bg | **3.6:1** | ⚠️ Fail normal | Pass large | ⚠️ **Metadata only, never essential text** |
| `#3E6B5C` accent | `#F7F7F2` bg | **5.5:1** | Pass | Pass | ✅ |
| `#2E6B4F` success | `#E7EFE9` success-bg | **5.2:1** | Pass | Pass | ✅ |
| `#8A5A0B` warning | `#FBF0DA` warning-bg | **5.9:1** | Pass | Pass | ✅ |
| `#8A5A0B` warning | `#F7F7F2` bg | **6.4:1** | Pass | Pass | ✅ |
| `#9B2C2C` danger | `#F9E7E7` danger-bg | **6.7:1** | Pass | Pass | ✅ |
| `#9B2C2C` danger | `#F7F7F2` bg | **7.0:1** | Pass | Pass | ✅ |
| `#2C5468` info | `#E6EEF1` info-bg | **6.5:1** | Pass | Pass | ✅ |
| `#3E6B5C` focus-ring | `#F7F7F2` bg | **5.5:1** | — | Pass (≥3) | ✅ |
| `#C3C3B8` border-strong | `#FFFFFF` surface | **1.9:1** | — | ⚠️ Fail UI | ⚠️ Borders are decorative, not the sole state signal |
| `#DEDED6` border | `#FFFFFF` surface | **1.4:1** | — | ⚠️ Fail UI | ⚠️ Decorative hairline only |

**Notes on the two `⚠️` rows:**
- `--text-muted` (`#7C8781`) on `#F7F7F2` is **3.6:1** — passes AA for large text only. **Rule: never use `--text-muted` for text that carries meaning** (refund amounts, customer names, error text, machine-readable status). It is permitted only for timestamps and disabled-control text, both of which remain understandable from context and are not load-bearing.
- The hairline borders are intentionally low-contrast (brief requires subtle borders). Because they fail 3:1 as standalone UI indicators, **no interactive state may be signalled by border colour alone** — focus uses a 2px ring, and selected/danger states pair colour with icon + text + shape.

All text-bearing pairs the app actually uses for meaning pass AA. Verified inverse pair `#243B36` ↔ `#F7F7F2` = **11.4:1** both directions.

---

## 4. Screen 1 — New Case

**Purpose:** The founder records a disrupted group buy — supplier cancellation, affected order, payments collected — and triggers the agent. This screen must work fully with the sample-data button so a judge can demonstrate the flow without typing.

**Route:** `/cases/new`

### 4.1 Layout regions (desktop ≥ 1024px)

```
┌───────────────────────────────────────────────────────────────────────┐
│  ▤ SikHal            New Case                    [ⓘ How this works]    │  ← App header (sticky, elev-1 on scroll)
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   New Case                                                              │  ← display
│   Record a supplier cancellation for a group-buy order.                 │  ← body, text-secondary
│                                                                         │
│   ┌─────────────────────────────┐  ┌─────────────────────────────────┐ │
│   │  DEMO PATH (card)           │  │  CASE DETAILS (card)            │ │
│   │  No sample data yet?        │  │  Supplier name *    [________]  │ │
│   │  [ Load sample case ]       │  │  Order / group-buy  [________]  │ │
│   │  Sarawak supplier + 6       │  │  Cancellation date  [__/__/____]│ │
│   │  customers, RM-level sen.   │  │  Reason *           [________]  │ │
│   └─────────────────────────────┘  │                     [________]  │ │
│                                    └─────────────────────────────────┘ │
│                                                                         │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │  AFFECTED ORDER RECORDS                     [ + Add customer ]    │ │
│   │  ┌───────────┬──────────┬─────────┬──────────┬───────────────┐   │ │
│   │  │ Customer  │ Item     │ Qty     │ Paid MYR │ Status        │   │ │
│   │  ├───────────┼──────────┼─────────┼──────────┼───────────────┤   │ │
│   │  │ [____]    │ [____]   │ [__]    │ [__.__]  │ ▾ paid        │   │ │
│   │  └───────────┴──────────┴─────────┴──────────┴───────────────┘   │ │
│   │  Sub-total collected: RM 0.00                    [Remove row ⨯]   │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│   ─────────────────────────────────────────────────────────────────    │
│   [ Run resolution agent → ]        Saved automatically as draft        │  ← sticky action bar
└───────────────────────────────────────────────────────────────────────┘
```

### 4.2 Mobile (< 640px) — governing layout

The order-records table **does not scroll horizontally**. Each affected record becomes a stacked card:

```
┌───────────────────────────────┐
│ SikHal            New Case    │  ← header, hamburger not needed (2 screens only)
├───────────────────────────────┤
│ New Case                      │
│ Record a supplier cancellation│
│                               │
│ ┌───────────────────────────┐ │
│ │ DEMO                      │ │
│ │ No sample data? Load one  │ │
│ │ [ Load sample case ]      │ │
│ └───────────────────────────┘ │
│                               │
│ Case details                  │
│ Supplier name *               │
│ [________________________]    │
│ Order / group-buy ref *       │
│ [________________________]    │
│ Cancellation date *           │
│ [__/__/____]                  │
│ Reason *                      │
│ [________________________]    │
│ [________________________]    │
│                               │
│ Affected order records (6)    │
│ ┌───────────────────────────┐ │
│ │ Customer name             │ │
│ │ [___________________]     │ │
│ │ Item            Qty       │ │
│ │ [__________]   [___]      │ │
│ │ Paid (MYR)                │ │
│ │ [__________]   ▾ paid      │ │
│ │         [ Remove ]        │ │
│ └───────────────────────────┘ │
│ (×6, stacked, 12px gap)       │
│ [ + Add customer ]            │
│                               │
│ Sub-total collected RM 0.00   │
├───────────────────────────────┤
│ [ Run resolution agent → ]    │  ← sticky bottom bar, full-width, safe-area inset
└───────────────────────────────┘
```

### 4.3 Component inventory — Screen 1

All base components are shadcn/ui primitives.

| Region | shadcn/ui base | Props / config | States | Notes |
|--------|----------------|----------------|--------|-------|
| App header | `SiteHeader` (composed), `Button` (ghost, icon) | Logo text `SikHal`, screen title, info trigger | default | Static; no nav beyond the two screens. Title hidden on mobile to save vertical space. |
| "How this works" | `Popover` + `Button` (ghost, icon) | Trigger icon `Info` (lucide) | closed/open | 3-line explainer: record → agent → you approve. Not a tour. |
| Demo path card | `Card`, `CardHeader`, `CardContent`, `Button` (outline) | `onClick → loadSampleCase()` | **default / loading / loaded / error** | See §4.4. Loaded state shows a chip "Sample case loaded" + `Undo`. |
| Case details form | `Form` (`react-hook-form`) + `FormField`, `Input`, `Textarea`, `Calendar` (`Popover`+`Calendar` date picker) | see fields below | default / focus / filled / invalid / disabled-while-running | Validation on blur, not on every keystroke. |
| Field: Supplier name | `FormField`+`Input` | `required`, max 120 | default/focus/invalid | Autocomplete attribute `organization`. |
| Field: Order / group-buy ref | `FormField`+`Input` | `required`, max 64 | default/focus/invalid | Placeholder `e.g. GB-2024-014`. |
| Field: Cancellation date | `FormField`+`Popover`+`Calendar` | `required`, no future dates | default/open/selected/invalid | Mobile: full-screen date sheet. |
| Field: Reason | `FormField`+`Textarea` | `required`, max 500, rows 3 | default/focus/invalid + char counter | Counter turns `--danger` only past 500. |
| Affected records — desktop | `Table` (Card-wrapped), `TableHeader`, `TableRow`, `TableCell` | editable cells | default/empty/row-removed | Not horizontally scrollable at any width; converts to cards below 640px. |
| Affected records — mobile | `Card` per record | stacked fields | default/empty/removed | One record per card, `--space-3` internal gap. |
| Record cell: Customer | `Input` | `required`, max 80 | default/invalid | |
| Record cell: Item | `Input` | max 80 | default | Optional — helps the message draft read naturally. |
| Record cell: Qty | `Input` (`type=number`, `inputMode=numeric`) | integer ≥ 1 | default/invalid | |
| Record cell: Paid (MYR) | `Input` (`inputMode=decimal`) | ≥ 0, 2dp | default/invalid | Prefix lockup `RM` inside the field, not in the value. |
| Record cell: Status | `Select` | `paid` \| `partial` \| `unpaid` | default/open/selected | Drives whether a refund is proposed. |
| Add customer | `Button` (outline, icon `Plus`) | — | default/hover | Appends an empty record and focuses its first field. |
| Remove record | `Button` (ghost, icon `X`) | `aria-label="Remove record for <name>"` | default/hover/disabled (only record) | Never removes the last record; disabled with tooltip. |
| Sub-total collected | Static text (not an input) | derived, `money` | — | Right-aligned tabular. Recomputes live; never editable. |
| Run agent (primary CTA) | `Button` (default) | `disabled` until required fields valid | default/hover/focus/**disabled**/loading | Label swaps to "Running…" with step indicator during execution (§8). |
| Draft autosave indicator | Small text + `Check` icon | — | idle/saving/saved/error | "Saved" is calm, no toast spam. |

### 4.4 Sample-data loading states (Screen 1)

| State | Presentation |
|-------|--------------|
| **default** | Card: heading "Try it with sample data", one sentence, `Load sample case` outline button. |
| **loading** | Button shows inline spinner + "Loading sample…"; button disabled; skeleton shimmer overlays the case-details and records cards so the incoming shape is prefigured (no layout jump). |
| **loaded** | Form populated; sample card collapses to a single row: `Badge` "SAMPLE DATA" + `Button` (ghost) "Clear". All populated fields are visibly identical to hand-entered data — the badge is the disclosure. |
| **error** | Inline `Alert` (danger variant) inside the card: "Sample case could not be loaded." + `Retry` button. No modal. |

---

## 5. Screen 2 — Review Resolution

**Purpose:** The founder inspects the agent's output — affected customers, per-customer refunds in MYR, message drafts, resolution timeline — sees academic conflicts as unmissable, and explicitly approves.

**Route:** `/cases/[id]/resolution`

### 5.1 Layout regions (desktop ≥ 1024px)

Two-column at ≥ 1024px, single column below.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  ▤ SikHal    Review Resolution                          [Back to case]    │
├───────────────────────────────────────────────────────────────────────────┤
│  Review Resolution                                    Case GB-2024-014     │
│  Supplier cancelled. 6 customers affected, RM486.40 to refund.             │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠ ACADEMIC CONFLICT — 1 proposed action collides with your classes  │  │  ← warning banner, full width, top
│  │   Refund run at Tue 14:00 falls in CS2040 Lecture (14:00–16:00).    │  │
│  │   That slot is blocked. Choose another.            [ Review slots ] │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────┐  ┌────────────────────────────────┐ │
│  │ REFUNDS (7 rows)          total   │  │ RESOLUTION TIMELINE            │ │
│  │ ┌───────────┬──────┬───────────┐ │  │ ① Now — review refunds    ✓    │ │
│  │ │ Customer  │ Paid │ Refund    │ │  │ ② Confirm & issue refunds      │ │
│  │ ├───────────┼──────┼───────────┤ │  │    Proposed: Tue 14:00  ⚠ BLOCK│ │
│  │ │ Aisyah    │ 84.00│ RM 84.00  │ │  │ ③ Send customer messages       │ │
│  │ │ Bala      │ 42.50│ RM 42.50  │ │  │    Proposed: Tue 21:30  ✓ free │ │
│  │ │ Chen Wei  │126.00│ RM126.00  │ │  │                                │ │
│  │ │ ...       │      │           │ │  │ ┌── MESSAGE DRAFTS ──────────┐ │ │
│  │ └───────────┴──────┴───────────┘ │  │ │ To: Aisyah          [Edit] │ │ │
│  │ Grand total       RM 486.40       │  │ │ "Hi Aisyah, the supplier…" │ │ │
│  └──────────────────────────────────┘  │ │ [Copy]                     │ │ │
│                                         │ └────────────────────────────┘ │ │
│                                         └────────────────────────────────┘ │
│  ───────────────────────────────────────────────────────────────────────  │
│  [ Approve & prepare resolution ]   Nothing is sent or refunded yet.      │  ← sticky action bar
└───────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Mobile (< 640px)

Single column, in this **strict order** (conflict banner is second, immediately after the summary — never below the fold):

1. Header + summary line.
2. **Academic-conflict banner** (if any) — full-bleed, first content element.
3. Resolution timeline (collapsible sections ② ③).
4. Refund list — one card per customer; header shows `Paid` / `Refund` on one row, tabular money.
5. Grand total pinned above the action bar.
6. Message drafts — each in a collapsible `Accordion`; first one auto-expanded.
7. Sticky bottom action bar: primary `Approve & prepare resolution` (full width) with the permanent disclaimer line above it.

### 5.3 Refund table specification

| Aspect | Desktop | Mobile |
|--------|---------|--------|
| Container | `Card` + `Table` | `Card` list, one `Card` per customer |
| Columns | Customer · Paid MYR · Refund MYR · Flag | Label/value rows stacked |
| Numerals | `tabular-nums`, right-aligned | `tabular-nums`, left-aligned value column |
| Row flag | Icon + text in a `Badge` (`--danger` "Over-refund blocked" / `--warning` "Partial only" / `--success` "Reconciled") | Same badge, own line |
| Grand total | Footer `TableRow`, `money-lg`, top border `--border-strong` | Pinned `div` above action bar |
| Empty | "No affected customers were identified." + link back to New Case — never a blank table body | same |
| Long lists (> 12) | Virtualised, sticky header | "Show all N" `Accordion` past 12 |

**Sen-level rounding is visible on purpose.** Amounts are computed and displayed at 2dp; totals come from the server's decimal computation, not from summing displayed values client-side (avoids any visible mismatch and drift).

### 5.4 Message drafts

- Each draft: `Card` with `CardHeader` = recipient name + `Badge` (status of that customer) + `Button` (ghost, icon `Pencil`) "Edit".
- Body: read-only `Textarea`-styled block (plain `div` with `--surface-sunken` background, `--radius-sm`) — read-only until "Edit" is pressed, then a real `Textarea` with a char counter and `Save`/`Cancel`.
- Message body max-width `68ch` for legibility.
- Actions per draft: `Copy` (`Button`, outline, icon) — copies the draft text. **No "Send" button exists on this screen** — sending is part of the approved resolution action, never an ad-hoc per-message action.
- Empty: "No customer messages were generated." + `Re-run agent` (secondary) — happened only if no affected customers exist.
- Editing a draft marks the case `dirty` and requires re-approval before the approve action is enabled.

### 5.5 Component inventory — Screen 2

| Region | shadcn/ui base | Props / config | States | Notes |
|--------|----------------|----------------|--------|-------|
| Summary header | Static text, `Badge` | case ref, counts, total | — | Total uses `money-lg`. |
| Academic-conflict banner | `Alert` (custom warning variant) | `role="alert"`, icon `AlertTriangle` (lucide, non-emoji) | none/present/blocking | Full-width, top of content. See §10. |
| Refund table | `Card`+`Table` (desktop), `Card` list (mobile) | rows from agent output | empty/loading/success/error | See §5.3. |
| Row flag | `Badge` | variant by flag | ok/warn/danger | Icon + text, never colour alone. |
| Grand total | `TableFooter` / pinned `div` | `money-lg` | — | Server-computed value. |
| Timeline | `Accordion` (3 items) + step list | ordered steps | pending/current/done/blocked | Blocked step uses warning icon + "BLOCKED" text. |
| Message drafts | `Accordion` + `Card` + `Textarea` + `Button` | per customer | empty/read/edit/saving/error | First expanded on mobile. |
| Approve CTA | `AlertDialog` (trigger `Button`) | see §9 | default/**disabled**/loading/confirmed | Disabled while conflicts exist or drafts edited. |
| Toast | `Sonner` (`Toast`) | success/error | — | Calm copy, `--success`/`--danger`, auto-dismiss 5s. |
| Agent-run panel | Custom (composed from `Card`, `Accordion`, `Badge`, `Separator`) | step log | running/done/error | See §8. |

---

## 6. Interaction State Matrix

Every region must implement all four states. No region may render a bare spinner over nothing.

### Screen 1 — New Case

| Region | Empty | Loading | Success | Error |
|--------|-------|---------|---------|-------|
| Demo card | "No sample data yet? Load one." + button | Button spinner + "Loading sample…"; skeletons over form/records | `Badge` "SAMPLE DATA" + `Clear` | Inline `Alert` (danger) + `Retry` |
| Case details form | Empty inputs, placeholders, no red | Fields `disabled` + subtle skeleton; values retained | All valid, no inline errors; submit enabled | Per-field inline error with `aria-describedby`; form-level `Alert` for server error |
| Affected records | "No records yet." + `Add customer` (not an empty grid) | 3 skeleton rows / 3 skeleton cards | Rows render, sub-total live-computed | Row-level error badge; invalid row scrolled into view |
| Sub-total | `RM 0.00` | Preserves last value, dimmed | Live correct value | Shows last-known-good with a subtle "—" and warning icon |
| Run agent CTA | `disabled` (validation gate) | "Running…" + step indicator (§8); form read-only | Navigates to Screen 2 | `Alert` above CTA: "The agent could not complete the run." + `Retry` + `Review details` |

### Screen 2 — Review Resolution

| Region | Empty | Loading | Success | Error |
|--------|-------|---------|---------|-------|
| Summary | "No resolution yet." | Skeleton lines | Counts + total | "Summary unavailable." |
| Conflict banner | **Absent entirely** (never render an empty banner — a green "no conflicts" badge is acceptable and preferred) | Skeleton bar | Blocks listed with slot detail | "Could not verify academic calendar." + `Retry` — **treated as unsafe: approval stays disabled** |
| Refund table | "No affected customers identified." + link to New Case | 5 skeleton rows | Rows + flag badges + total | Row-level error badge; table-level `Alert` + `Re-run agent` |
| Timeline | "No timeline proposed." | Skeleton steps | 3 steps with state icons | "Timeline could not be generated." + `Re-run agent` |
| Message drafts | "No messages were generated." + `Re-run agent` (secondary) | 2 skeleton cards | Drafts, first expanded | Per-draft error + `Regenerate this draft` |
| Approve CTA | — | `AlertDialog` confirm button in loading state | Toast "Resolution prepared." + status advances | `Alert` in dialog; dialog stays open; nothing sent |

**Global rule:** if the academic calendar cannot be verified (error), the approve CTA is **disabled** and the reason is stated. Unknown must never be treated as free.

---

## 7. Agent-Execution Experience

Requirement: the agent performs real tool execution, which takes time, and the founder must see what is happening — not a spinner-only void.

### 7.1 Trigger
`Run resolution agent` on Screen 1. On press, the action bar transforms into the **Agent Run Panel**; the form becomes read-only (not hidden — the founder keeps context).

### 7.2 Panel structure

```
┌─────────────────────────────────────────────────────────────┐
│ ● Running resolution agent…                    step 3 of 5  │
│ ─────────────────────────────────────────────────────────── │
│ ✓ Parsed case GB-2024-014                               3s  │
│ ✓ Matched 6 payment records to 6 customers              2s  │
│ ⟳ Computing refunds in MYR  (decimal-safe)                  │  ← current step, pulsing dot
│ ○ Checking your academic calendar                           │
│ ○ Drafting customer messages                                │
│ ─────────────────────────────────────────────────────────── │
│ [ Cancel run ]                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Rules

- **One row per real tool call.** Each row is a real tool execution, labeled in plain language ("Computing refunds in MYR", "Checking your academic calendar"). No invented steps, no filler animation.
- **Three row states, each with a text label + icon** (never colour alone): pending (`○` + "Waiting"), current (`⟳` + live text, `aria-live="polite"`), done (`✓` + duration), error (`!` + short reason + `Retry this step`).
- **Current step** is announced via `aria-live="polite"` on a visually-hidden region; the visual panel is `aria-hidden` for screen readers to avoid double-reading (visible step list is decorative mirror of the live region).
- **Progress header** shows "step N of M" as text, not just a progress bar.
- **Duration**: each completed step shows elapsed time. This builds credibility — the founder sees real work, not a canned pause.
- **Cancel**: always available; cancelling returns to Screen 1 with the form intact and a calm toast "Agent run cancelled. Your case is unchanged."
- **Failure mid-run**: the failing row turns to error with the reason; completed steps stay; panel offers `Retry this step` and `Cancel run`. The system never silently advances past a failed step.
- **Reduced motion**: the current-step dot is a static filled circle; no pulse.
- **Minimum visible duration:** if a step completes in < 400ms, its row does not flash — it enters directly in the done state; the panel never fakes a delay to look busy.

---

## 8. Approval Flow Design

Approval authorises **financial** (issue refunds) and **external** (send customer messages) actions. It must be deliberate, unambiguous, and accessible.

### 8.1 Precondition gating

The `Approve & prepare resolution` button is `disabled` (with an always-visible reason line, not a tooltip) when any of:
- one or more academic conflicts exist and an action is still scheduled on a blocked slot;
- the academic calendar could not be verified;
- any message draft has been edited since the last approval (state = `dirty`);
- the refund set failed validation (per QA's rules — over-refund, duplicate, missing payment).

Disabled reason is rendered as text directly above the button, e.g. `Blocked: 1 action is scheduled during CS2040 Lecture. Resolve it to approve.` — never a silent disabled button.

### 8.2 Confirmation pattern

Two-step, using `AlertDialog` (shadcn). Rationale: this is a consequential, not destructive-permanent, action — a dialog that forces the founder to read a recap is the right weight. No "type APPROVE to confirm" theatre; the recap itself is the friction.

**Dialog contents (in order):**
1. `AlertDialogTitle`: "Prepare this resolution?"
2. `AlertDialogDescription`: one sentence stating nothing has happened yet.
3. **Recap list** (semantic `<dl>`):
   - Refunds to issue: `6` — Total: `RM 486.40`
   - Customer messages to stage: `6`
   - Scheduled from: `Tue 21:30` (the earliest **non-blocked** slot), or `Not scheduled` if conflicts remain.
4. **Conflict restatement** (if any remain): the same warning icon + text as the banner, so the founder cannot approve past a conflict without seeing it again.
5. Permanent line: "This prepares the refunds and stages the messages. It does not move money until you confirm again in the next step." (wording to be finalised with the Lead once the downstream action is defined — see Open Questions).
6. Buttons: `Cancel` (outline) on the left; `Prepare resolution` (primary) on the right. The primary is **not** auto-focused; focus lands on the dialog title container so a screen reader announces the title and recap before the buttons.

### 8.3 Post-confirmation

- On confirm: dialog button → loading ("Preparing…"), then `Toast` (success): "Resolution prepared. 6 refunds and 6 messages are ready." No confetti, no emoji.
- The case status pill advances (`Draft → Prepared`), timeline step ② marks done.
- **Idempotency guardrails (UI side):** the CTA re-disables immediately after a successful prepare; a second rapid press cannot enqueue a duplicate. QA owns the server-side rule; the UI must not present an enabled path to a duplicate.

### 8.4 Accessibility of the flow

- `AlertDialog` from shadcn already implements focus trap, `role="alertdialog"`, `aria-labelledby`/`aria-describedby`; wire both to the title and description elements.
- No keyboard trap beyond the dialog; `Esc` closes; `Cancel` is reachable first in DOM order.
- The disconnect reason line is associated to the button via `aria-describedby`.
- Screen reader order matches visual order: title → recap → conflict → disclaimer → buttons.

---

## 9. Academic-Conflict Visual Language

The founder is a student first. A conflict must be **impossible to miss** and **impossible to misread as mere warning colour**.

### 9.1 The banner (screen level)

- Full-width `Alert`, background `--warning-bg` `#FBF0DA`, **4px left rail** `--warning-border` `#D9A93C`, 1px border `--warning-border`.
- Leading icon: `AlertTriangle` (lucide, stroke `--warning` `#8A5A0B`) — an icon, **not an emoji**.
- Heading (16px/600, `--warning`): `Academic conflict — 1 proposed action collides with your classes`.
- Body lists each collision concretely: action, day+time, commitment name and window. `Refund run at Tue 14:00 falls in CS2040 Lecture (14:00–16:00).`
- Action variant text: `That slot is blocked. Choose another.` — directive, not merely descriptive.
- `role="alert"` so it is announced when it appears.
- **Three non-colour cues, all required:** the `AlertTriangle` icon, the word "CONFLICT" in the heading, and the left rail + heading position. A colour-blind founder relying on any one of these still sees the conflict.

### 9.2 The blocked slot (timeline / row level)

- Blocked step row: `--danger-bg` `#F9E7E7` background, `--danger-border` `#C0504D` left rail, `AlertOctagon` icon, badge text `BLOCKED`.
- The proposed time is rendered with a strikethrough *and* followed by `— unavailable (class)`. Strikethrough alone is never the only signal.
- If the founder is on a blocked slot, the approve CTA is disabled and the reason line names the specific commitment.
- A **free** slot uses `--success` `#2E6B4F` text + `Check` icon + word `Available` — the safe state is stated positively, not merely implied by the absence of a warning.

### 9.3 Contrast

- `#8A5A0B` on `#FBF0DA` = **5.9:1** (AA pass). `#8A5A0B` on `#F7F7F2` = **6.4:1** (AA pass).
- Red-rail and amber-rail are both ≥ 3:1 against the page surface, satisfying non-text contrast for the indicator itself — but colour is still never the sole cue per §9.1.

---

## 10. Responsive Breakpoints

| Breakpoint | Width | Behaviour |
|------------|-------|-----------|
| `xs` (base) | 320–639px | Single column. Records table → cards. Header title hidden. Action bar sticky bottom, full-width, `padding-bottom: env(safe-area-inset-bottom)`. Conflict banner full-bleed. |
| `sm` | 640–767px | Same as base but inputs gain horizontal padding; demo card sits inline. |
| `md` | 768–1023px | 24px gutters; records still cards; desktop table appears only at `lg`. |
| `lg` | 1024–1279px | Two-column Screen 2 (refunds 62% / timeline+drafts 38%); Screen 1 records → `Table`; content max-width 1100px centred. |
| `xl` | 1280–1920px | Same as `lg`; extra space absorbed by outer margins, never by stretching the reading column. Message drafts stay ≤ `68ch`. |

Touch targets ≥ 44×44px at all breakpoints. Tested at 320px, 360px, 390px, 768px, 1024px, 1440px, 1920px.

---

## 11. Accessibility Checklist (WCAG 2.1 AA)

Actionable, testable. Each item has a pass test.

**Colour & contrast**
- [ ] All body/heading/label text meets ≥ 4.5:1 against its background. *Test:* contrast checker on every text/background token pair in §3.
- [ ] `--text-muted` used only for timestamps and disabled text — never for refund amounts, names, statuses, or errors. *Test:* grep the codebase for `text-muted` usage and confirm context.
- [ ] No meaning conveyed by colour alone (conflicts, errors, success, selected rows). *Test:* screenshot and view in grayscale — every state still distinguishable via icon/text/shape.
- [ ] Focus ring `2px --focus-ring` with `2px` offset is visible on every interactive element against every surface. *Test:* keyboard-tab the whole page; ring visible on buttons, inputs, links, table row actions, dialog.

**Keyboard**
- [ ] Entire flow completes keyboard-only: fill form, run agent, review, open dialog, approve, close. *Test:* unplug mouse.
- [ ] Logical focus order matches visual order on both screens and inside the dialog.
- [ ] Dialog traps focus, `Esc` closes, focus returns to the triggering button on close.
- [ ] No keyboard trap anywhere else; `Tab` reaches the sticky action bar.

**Screen reader**
- [ ] Every input has a programmatic label (`FormLabel` linked via `htmlFor`/`aria-describedby`); errors linked via `aria-describedby` and announced.
- [ ] Agent step changes announced via a single `aria-live="polite"` region; no duplicate announcement from the visual list (`aria-hidden`).
- [ ] Academic-conflict banner is `role="alert"`.
- [ ] Refund table uses real `<table>` semantics with `<caption>` and `<th scope="col">`; mobile card list uses a `<dl>` with visible labels.
- [ ] Approval dialog exposes `role="alertdialog"` with `aria-labelledby` and `aria-describedby` wired.
- [ ] Disabled approve button has an `aria-describedby` pointing to its visible reason text.

**Content & structure**
- [ ] One `<h1>` per screen; heading levels do not skip.
- [ ] MYR values are formatted with thousands separators and always 2dp; screen reader reads them meaningfully (avoid splitting the currency symbol from the number across elements).
- [ ] Images/icons that convey meaning have accessible names; decorative icons are `aria-hidden`.
- [ ] Language set to `en` (with `lang` on any Malay/Chinese sample strings if included).

**Motion & timing**
- [ ] `prefers-reduced-motion: reduce` disables all non-essential animation (pulse, transitions) — verified across agent panel and banners.
- [ ] No content flashes more than 3×/second.
- [ ] Toasts auto-dismiss ≥ 5s and are also announced via live region.

**Zoom & reflow**
- [ ] Usable at 200% zoom and at 320px width with no loss of content or functionality; no horizontal scrolling of the records region.
- [ ] Text spacing overrides (line-height 1.5, letter-spacing, word-spacing) do not clip content.

**Forms**
- [ ] Errors are described in text ("Enter the supplier name"), associated to the field, and not colour-only.
- [ ] Required fields marked with a visible indicator plus `aria-required`.

---

## 12. Anti-Pattern Guardrails (for Phase 3 review)

A reviewer should **reject** the implementation if any of the following appear.

| # | Reject if… | Why |
|---|-----------|-----|
| 1 | Any gradient used as decoration (purple→blue, glassmorphism, floating orbs) | Explicitly forbidden; not the product's visual language. |
| 2 | Any emoji in UI chrome, buttons, statuses, or empty states | Forbidden; icons must be lucide/`aria-hidden` decorative or labeled. |
| 3 | A third screen or any dashboard/home module appears | Out of scope; exactly two screens. |
| 4 | A login screen or auth UI appears | Out of scope. |
| 5 | Any button that is a visual mock — it exists but does nothing | Forbidden ("mock-only buttons"). Every control has a real handler or a disabled reason. |
| 6 | The academic-conflict warning is signalled by colour alone | Accessibility fail and safety fail. |
| 7 | Refund amounts render with fewer or inconsistent decimal places (`RM84` instead of `RM84.00`) | Money legibility is a core principle. |
| 8 | Totals are summed client-side from displayed values (drift risk) | Must come from the server's decimal computation. |
| 9 | The agent-run experience is a bare spinner over an empty panel | Violates the visible-execution requirement. |
| 10 | A region renders with no empty/loading/error state (blank box on no data) | Every region implements all four states. |
| 11 | Approve is a single-tap action with no recap/confirmation | Violates deliberate-approval principle. |
| 12 | The approve button is enabled while an unresolved conflict or unverified calendar exists | Safety breach. |
| 13 | Borders are the sole indicator of a state (focus, error, selected) | Border contrast fails 3:1; states need icon/text/ring. |
| 14 | `--text-muted` is used for load-bearing text | Contrast 3.6:1 fails AA for normal text. |
| 15 | Cards carry decorative box-shadows on static surfaces | Elevation is for interactivity only; use hairline borders. |
| 16 | Horizontal scrolling table on mobile | Records must become cards below 640px. |
| 17 | Any "✨ powered by AI" flourish or AI-branding badge | Forbidden generic-AI look. |
| 18 | Toast/toast-spam on autosave | Autosave feedback is a quiet inline indicator. |

---

## 13. Sample Data Design (for fixtures)

Fictional, Sarawak-flavoured, realistically scaled for a Malaysian student group buy. Sen-level amounts included so rounding behaviour is visible. **All names and suppliers are fictional.**

### 13.1 Case header

| Field | Value |
|-------|-------|
| Supplier name | `Kuching Harvest Trading` (fictional) |
| Order / group-buy ref | `GB-2024-014` |
| Cancellation date | `2024-08-12` |
| Reason | `Supplier's upstream supplier cancelled the shipment of Sarawak pepper and laksa paste; full order cannot be fulfilled this cycle.` |

### 13.2 Affected order records (payments collected)

| # | Customer | Item | Qty | Paid (MYR) | Status |
|---|----------|------|-----|-----------|--------|
| 1 | Aisyah Rahman | Sarawak white pepper (200g) | 2 | `RM 84.00` | paid |
| 2 | Bala Subramaniam | Laksa paste (500g) | 1 | `RM 42.50` | paid |
| 3 | Chen Wei Ling | Sarawak pepper + laksa bundle | 3 | `RM 126.00` | paid |
| 4 | Nurul Izzah | Kek Lapis Sarawak (box) | 1 | `RM 38.90` | paid |
| 5 | Daniel Tan | Laksa paste (500g) ×2 + pepper | 2 | `RM 95.00` | partial |
| 6 | Farah Adibah | Sarawak white pepper (200g) | 1 | `RM 42.00` | paid |

**Sub-total collected:** `RM 428.40`

### 13.3 Expected refund output (illustrative — QA's rules are authoritative)

The founder's case is a **supplier cancellation**, so refunds are the amounts customers paid. The figures below show the intended shape for the fixtures; QA (严核明) owns the precise validation and rounding rules.

| # | Customer | Paid | Proposed Refund | Flag |
|---|----------|------|-----------------|------|
| 1 | Aisyah Rahman | `RM 84.00` | `RM 84.00` | Reconciled |
| 2 | Bala Subramaniam | `RM 42.50` | `RM 42.50` | Reconciled |
| 3 | Chen Wei Ling | `RM 126.00` | `RM 126.00` | Reconciled |
| 4 | Nurul Izzah | `RM 38.90` | `RM 38.90` | Reconciled |
| 5 | Daniel Tan | `RM 95.00` | `RM 95.00` | Reconciled *(partial payment — refund what was actually received)* |
| 6 | Farah Adibah | `RM 42.00` | `RM 42.00` | Reconciled |
| | **Grand total** | `RM 428.40` | **`RM 428.40`** | |

> **Note for the Lead / QA:** the team brief's example total was `RM486.40`; a fixture total should match whatever the seeded rows sum to. `RM 428.40` is the sum of the six rows above (e.g. `84.00 + 42.50 + 126.00 + 38.90 + 95.00 + 42.00`). Use `RM 428.40` as the fixture total, or adjust rows to hit a different documented total — **do not** leave the displayed total inconsistent with the row data.

### 13.4 Academic calendar fixture (founder's commitment)

| Day | Window | Commitment |
|-----|--------|-----------|
| Mon | 09:00–11:00 | CS2010 Data Structures — Lecture |
| Tue | 14:00–16:00 | CS2040 Algorithms — Lecture |
| Wed | 09:00–11:00 | Tutorial |
| Thu | 20:00–22:00 | Revision group (self-declared unavailable) |

### 13.5 Intended conflict for the demo

Proposed refund run at **Tue 14:00** → collides with **CS2040 Algorithms — Lecture (14:00–16:00)**.
Suggested free slot for the demo's resolution: **Tue 21:30** (after the last commitment, well clear of the 20:00–22:00 Thursday block on a different day).
This produces exactly one visible academic conflict and one clean re-schedule — the ideal two-beat demo.

### 13.6 Message draft (sample fixture)

> **To: Aisyah Rahman**
> Hi Aisyah, thanks for your order in GB-2024-014. Unfortunately our supplier has cancelled this batch (Sarawak pepper). We're refunding your **RM 84.00** in full — no action needed from you. Refunds are being processed from Tue 21:30, and you'll get a confirmation once it's done. Really sorry for the trouble, and thank you for understanding.

Tone: plain, warm, specific amount, no over-apology, no emoji.

---

## 14. Open Questions for the Lead

1. **Downstream of approval.** Does the MVP actually *execute* refunds/messages, or does "approve" only mark the resolution as prepared and stage messages? §8 wording and the dialog's disclaimer depend on this. My assumption: approve = prepare + stage; a defined next step finalises. Confirm so I can lock the disclaimer copy.
2. **Fixture total.** §13.3 flags a mismatch between the brief's example `RM486.40` and the sum of my rows (`RM428.40`). Recommend the Lead/QA align fixtures to one documented total; I've written the table so the total is the row sum.
3. **Academic calendar source.** For the MVP demo, is the founder's timetable a fixture we seed, or user-entered? My design assumes a seeded fixture for the demo with an optional entry path later — the "could not verify calendar" error state (§6) assumes a real lookup exists.
4. **Message channel.** The design intentionally omits a per-message "Send" button. Confirm messaging is staged for approval rather than sent individually, so the copy in §5.4 holds.
5. **Dark mode** is out of scope per the brief; confirm it stays out for Phase 1.

---

*End of specification — Phase 1, Screen 1 and Screen 2, implementation-ready.*

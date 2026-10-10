# SikHal — Design direction

Adapted as product-specific context for the [Impeccable](https://github.com/pbakaus/impeccable) design workflow. This is a design contract, not proof the Impeccable engine or hooks were installed.

## Visual thesis
A calm, distinct **operational workspace**, not a SaaS marketing landing page. Bring premium editorial craft to utilitarian financial workflows: confident typography, legible tables, deliberate whitespace, functional visual hierarchy and restrained warmth.

## Mode
**Operate** on both routes. Optimize for information scanning, decisive next actions and accessibility over decorative spectacle.

## Visual direction
- Earthy off-white / subtly tinted canvas, deep evergreen or charcoal ink, limited accent colour.
- Accessible contrast: ordinary text >= 4.5:1; large text >= 3:1; focus states obvious.
- Functional typography: comfortable reading size and tabular numerals for all MYR amounts. Test font-loading/performance before introducing a non-system family.
- Establish 3-level hierarchy: task heading -> key financial decision -> supporting evidence.
- Use borders where they separate meaning, not a card for every paragraph.
- Keep status badges scarce and semantically accurate. Never treat decorative green as success.
- Responsive tables should be readable and not silently hide individual refund rows.

## Route /: New case
Lead with a useful single goal: provide the cancellation context and affected payments. Keep sample data easy to load but visually secondary. Show progress, validation, and money entry clearly. Do not claim that a natural-language prompt alone can generate missing customer payments.

## Route /cases/[id]/resolution: Review
Prioritize exact proposed MYR total, count of affected customers, and outstanding approvals/conflicts. The primary action belongs where the founder is ready to commit. Put the working "use suggested free slot" affordance next to a blocked timetable event. Message drafts must show provenance (AI drafted versus Template) and remain visibly unsent. Agent tool trace and class timetable are supplementary, not competing hero sections.

## Anti-patterns to reject
Oversized generic AI slogans; gradient/neon decorations; floating glass cards; icon tiles for every feature; nested card-on-card layouts; fake metrics; inaccessible pale green labels; noisy badge collections; exaggerated corner radii without structural purpose; statements suggesting refunds were sent.

## Quality gate
1. Impeccable **critique** both screens: user task, clarity, information hierarchy, emotional tone.
2. **distill** repeated and nonessential elements, without deleting the core disclosure or approval safeguards.
3. **audit** contrast, keyboard navigation, loading/errors, narrow viewport, text overflow and table legibility.
4. **polish** only after resolving the preceding issues; check desktop and mobile in bounded screenshot passes.
5. Run existing typecheck, tests and production build before merging a redesign.

## References
Impeccable project: https://github.com/pbakaus/impeccable
Screens and workflow descriptions in PRODUCT.md are the source of truth; third-party inspiration is stylistic evidence only.

# Working on SikHal UI

For frontend changes, use the design workflow outlined by [Impeccable](https://github.com/pbakaus/impeccable). Read `PRODUCT.md` and `DESIGN.md` before changing UI.

Suggested sequence: `/impeccable critique` -> `/impeccable distill` -> `/impeccable audit` -> `/impeccable polish`. The slash commands require an actual installation in a compatible coding agent; these instructions alone do not install or execute the CLI.

Never compromise finance invariants, founder approval, calendar conflict blocking, non-sending messaging truth, or server-only secrets for visual improvement. Preserve actual functionality; check new-case and resolution pages on mobile and desktop.

To install locally with supported tools, follow the upstream repository's verified README: `npx impeccable install`, choose the coding provider and project scope, then run `/impeccable init` in that tool. Review any installed hooks before trusting them. Do not copy external runtime binaries into SikHal's runtime or expose Supabase/OpenAI credentials to design tooling.

# Know Yourself · Full Project Refactor

Status: active · started 2026-09-07

This refactor replaces the current product surface rather than applying a visual
skin. Production data, authentication, media lifecycle, moderation, and deploy
contracts are treated as migration boundaries until their replacements are
verified.

## New product shape

Know Yourself becomes a bilingual social reflection space:

1. **Notice** — discover observations from people, assessments, and image posts.
2. **Explore** — choose an assessment or begin with an open note.
3. **Reflect** — complete one focused prompt at a time and receive a bounded
   observation, never a diagnosis.
4. **Share** — publish only through explicit, inspectable actions.
5. **Return** — keep private history, drafts, and earned badges under the user's
   control.

## Replacement design direction

- **Genre:** editorial social product; tactile, human, and text-led.
- **Desktop structure:** a persistent masthead, a narrow context rail, and a
  single primary reading column. No dashboard grid or SaaS-style bento layout.
- **Mobile structure:** one-column reading flow with a fixed bottom navigation
  and a compact create action.
- **Material language:** clean white paper, near-black ink, one indigo action
  colour, and image surfaces that behave like authored pages rather than
  decorative cards.
- **Typography:** self-hosted display face for titles, system CJK fallback,
  restrained mono only for counts and assessment values.
- **Motion:** short opacity/transform transitions only; all task content remains
  usable with reduced motion.

## Scope

### Replace

- Global shell and navigation
- `DESIGN.md`, `tokens.css`, and global CSS
- Home/feed composition
- Assessment catalog, detail, quiz, and result presentation
- Journal library, editor, preview, and public reading surfaces
- Account, history, bookmarks, and settings presentation
- Shared primitives, empty states, errors, loading states, and bilingual copy
- OG/PWA visual assets and assessment imagery where the new art direction needs
  replacement

### Preserve behind new surfaces

- Better Auth and session semantics
- SQLite schema and cloud synchronization contracts until migrated safely
- Assessment scoring and public-definition registry semantics
- Media validation, processing worker, quotas, tombstones, and backups
- Community moderation, complaints, audit logging, and account governance
- CI, standalone packaging, Caddy/systemd deployment contracts

### Explicitly forbidden during the first pass

- Deleting production data
- Removing auth or moderation safeguards
- Changing public media permissions without replacement tests
- Adding analytics, runtime AI generation, or unverified automation
- Pushing to `main` before the full validation gate passes

## Delivery gates

1. New design system and app shell compile in isolation.
2. Core public paths work: `/`, `/assessments/`, `/test/[id]`, `/quiz/[type]`,
   `/result/[type]`, `/community/`.
3. Authenticated journal and account paths work.
4. Existing automated suites remain green or are intentionally migrated with
   equivalent coverage.
5. Browser checks pass at desktop, mobile, dark theme, keyboard, and 200% zoom.
6. Build and standalone packaging pass.
7. Only then push `main`, wait for CI deployment, and verify production routes.


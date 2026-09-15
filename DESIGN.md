# Design — 认识你自己 | Know Yourself

A locked design system for the rebuilt application. Product truth lives in
`PRODUCT.md`; this file owns the visual and interaction world.

## Direction

**Creative north star: a community broadsheet assembled one observation at a time.**

The interface borrows the hierarchy and material honesty of a small independent
publication without imitating distressed paper or retro decoration. Posts are
the issue. Assessments are recurring editorial instruments. Private drafts are
the writer's desk.

## Genre

Editorial social product: tactile, direct, text-led, and operationally clear.

## Macrostructure families

- **Community and discovery:** masthead + editorial statement + creation desk + single reading column.
- **Focused tasks:** compact masthead + narrow workbench.
- **Libraries and operations:** index rail + working column.
- **Long-form content:** bounded reading column with marginal metadata.

## Theme

- `--color-paper`: cool near-white, `oklch(98.8% 0.003 255)`
- `--color-paper-strong`: pure stock, `oklch(99.8% 0.001 255)`
- `--color-ink`: near-black blue, `oklch(25% 0.02 258)`
- `--color-muted-text`: slate grey, `oklch(46% 0.015 258)`
- `--color-accent`: indigo, `oklch(50% 0.15 265)`
- `--color-support` (teal): steel blue, `oklch(50% 0.065 210)`
- `--color-signal`: amber, `oklch(70% 0.11 80)`
- `--color-danger`: red, `oklch(50% 0.16 25)`

A clean white page with near-black ink. Indigo marks actions and current
state. Steel blue identifies secondary information. Amber is reserved for
measured values. The palette intentionally reads as a calm modern product
rather than simulated newsprint.

## Typography

- Display: Archivo variable, weights 600–700 in use (620 for section titles, 640 for headlines), upright only.
- Body: system sans with native CJK metrics.
- Data: IBM Plex Mono, only for scores, counts, dates, and question indices.
- Display tracking: `-0.025em` for Latin and `0` for Chinese.
- Body measure: 65–75 characters.
- Heavy 750–850 weights are prohibited: CJK falls back to system sans, where
  synthetic bold reads as chunky rather than editorial.

## Spacing and shape

- Four-point named spacing scale in `tokens.css`.
- Page width: 80rem maximum; primary reading column: 46rem maximum.
- Controls use small corners; cards use restrained corners; pills are reserved for filters, tags, and compact statuses.
- Separation prefers rules and whitespace. Shadows are reserved for overlays or a genuinely lifted editor surface.

## Motion

- Active publication/filter strips settle with a short overshoot.
- Ordinary feedback uses color, opacity, and transforms under 240ms.
- Content is visible before animation.
- Reduced motion removes movement without removing state.

## Shared component grammar

- The masthead is a horizontal editorial rule, not a floating navigation card.
- Feed items are articles. Their typography and media determine their rhythm.
- Author, date, content type, badges, and moderation state share one metadata system.
- Inputs resemble writing fields with visible labels and complete recovery text.
- Empty states explain the missing material and offer one useful next action.

## Accessibility and privacy

- All controls remain keyboard operable with visible focus.
- Touch targets are at least 44 CSS pixels.
- Layouts work at 320, 375, 414, and 768px, at 200% zoom, and without motion.
- Chinese and English keep equivalent hierarchy and actions.
- Publication, draft, processing, hidden, unpublished, and deletion states are named before the user acts.

## Prohibited defaults

- No bento dashboard, glass cards, gradient text, decorative mesh, fake browser chrome, or icon-tile feature grid.
- No diagnosis language, invented usage figures, testimonials, or clinical claims.
- No decorative monospace, italic display headings, emoji icons, or duplicated heading kickers.
- No inaccessible hover-only actions or drag-only ordering.
- No runtime third-party fonts, analytics, or AI image generation.

## Implementation source

`tokens.css` keeps the structural scale; the active colour palette lives in the
`:root` and `.dark` blocks of `src/app/refactor.css`. `src/app/refactor.css`
also implements the new shell and migrated surfaces. Legacy selectors may
remain only while an unmigrated route still consumes them; new components use
the `press-*` namespace.

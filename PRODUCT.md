# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a Chinese-speaking first-time visitor who arrives with a concrete but loosely articulated question about personality, emotions, relationships, work, or daily life. They want useful structure within a few minutes, are not seeking a diagnosis, and should not have to create an account or publish anything before receiving value.

Secondary users are:

- Returning self-explorers who want to revisit an earlier result, record what was happening at the time, compare change, or take another related assessment.
- People who have completed an assessment and want relevant peer experience around the same topic, while retaining control over anonymity and what becomes public.

English remains a fully supported interface language, but bilingual capability is not evidence that Chinese and English are equally important acquisition markets. That remains an open decision until usage data exists.

The product is not intended for clinical diagnosis, treatment, crisis intervention, employment or school selection, or other high-stakes decisions. It is also not designed primarily for generic social browsing, audience building, or entertainment-only identity labels.

## Starting Point

The working product hypothesis is that people often feel a recurring tension before they have precise language for it. A blank journal asks too much too early, while many online tests produce a memorable label but no useful continuation. Structured questions can lower that starting burden, but lasting value only appears when the result becomes an understandable observation that can be revisited, tested in real life, and compared over time.

Public expression has a higher trust and privacy cost than private reflection. The product therefore earns the right to offer community only after it has delivered personal value, and it must never assume that a user wants to publish a sensitive result.

## Product Purpose

Know Yourself helps a person turn a vague self-question into a bounded, understandable, and revisitable observation. The core journey is:

1. Choose a reviewed assessment that matches the question currently pulling at their attention.
2. Complete it through a calm, low-friction answering experience.
3. Receive an explainable result with evidence, limitations, real-life context, and one useful next step.
4. Privately save a reflection, revisit history, compare change, or continue with a related assessment.
5. Optionally read or contribute experience tied to that assessment or topic, with explicit publishing and privacy boundaries.

Success is not merely finishing a test or producing a post. Success means the result creates a meaningful next action and gives the person a credible reason to return on another day.

## Positioning

Know Yourself is a private-first online self-exploration product centered on curated assessments. Unlike entertainment quiz sites that stop at a label, clinical tools that imply diagnosis, or generic communities that demand public performance, it connects structured assessment to transparent explanation, private continuity, and optional context-bound peer experience.

Its internal positioning is: **Start with one assessment; build self-knowledge that can accumulate.**

Local-first storage, optional accounts, and explicit publishing are mechanisms that support this promise. Guest assessment history stays on the device and can merge into an account after sign-in. Private work never becomes public by default. Results are observations and prompts, not diagnosis, treatment, ability judgments, or fixed identity.

## Operating Context

- A standalone Next.js application runs on a self-managed VPS after GitHub Actions validation and release. Caddy terminates TLS, serves eligible processed public media, and reverse-proxies application requests.
- Better Auth accounts, sessions, synchronized assessment data, journal records, moderation state, quotas, jobs, and audit records use SQLite outside release directories.
- Journal files live outside SQLite under the durable media root. A separate worker consumes a persistent task queue and creates metadata-stripped WebP variants.
- Guest results, history, bookmarks, language, theme, and backups live in the current browser. Signed-in users automatically synchronize the merged assessment data set and profile.
- Daily same-host consistency snapshots cover SQLite, media, and deletion tombstones, with a rolling 30-day retention. They are not off-host disaster recovery.

## Capabilities and Constraints

- The current homepage is a unified community feed. This is a transitional implementation, not the target information architecture. The next product revision makes assessments the primary first-visit path and moves community discovery to a secondary entry and to relevant post-result moments.
- 16 public assessments span type, dimensions, and score models. The first-visit experience should deliberately feature 5 to 8 flagship paths with distinct roles such as low-friction entry, trust building, or deeper exploration. The remaining public catalog can stay browsable. 193 internal modules remain available for staged content review but are not public routes by default.
- Animal Personality, Emotion Regulation, Attachment Style, and Life Satisfaction form the first result-image pilot. Their wordless metaphor scenes appear consistently on catalog cards, detail pages, and results. Text remains the complete information and accessibility source.
- Optional result-image feedback is stored only as a first-party daily aggregate keyed by assessment, visual key, and helpful/not-helpful response.
- Image journals require a signed-in, email-verified account. A journal has an optional title and body, one to six ordered images, optional per-image captions, and either alt text or a decorative flag.
- SMTP delivers account-verification and password-reset mail. A password-recovery request is Turnstile-verified and returns an enumeration-safe response; the reset token is single-use, expires in 30 minutes, and completing a reset revokes every existing session.
- The editor supports upload progress, retrying an interrupted transfer from the client-held file, selecting a replacement after server-side processing failure, deletion, drag enhancement, explicit move-up/move-down controls, autosave, interrupted-session recovery, private preview, and public preview. The server never retains an original merely to retry processing later.
- Publication is immediate and indexable. A published revision is immutable; later edits remain private until the owner explicitly updates the public version. Unpublishing and deletion are separate actions.
- Community currently uses one mixed feed with filters for assessments, text, and images. Its strategic role is narrower: relevant experience around an assessment, result, dimension, or reflection prompt. A generic feed is not a primary retention mechanism unless behavior data later proves otherwise.
- Assessment badges are derived on the server from a signed-in account's completed public assessments, so nothing is reported by the client and nothing can be forged. Each earned result variant joins the account's collection; the owner may wear at most three and must separately opt in before worn badges appear next to their name on community posts, comments, and image posts. Badges show result labels only, never scores or dimension values. Badges are a secondary expression feature, not a core retention mechanism, and must not turn a temporary observation into a fixed identity.
- Public content supports resonance, comments when enabled by the author, and reports. A high-risk report hides content immediately; three independent ordinary reports trigger temporary hiding.
- The first release has no pre-publication content review or blur for otherwise lawful sensitive material. Illegal material, sexual content involving minors, non-consensual intimate imagery, privacy exposure, and explicit harm remain prohibited report categories.
- One environment-configured administrator uses `/admin/moderation/` to review hidden content, restore it, permanently remove it, review privacy/copyright complaints, change account governance status, and inspect append-only audit records.
- Account governance states are normal, upload-blocked, read-only, suspended, and banned. The same write restrictions apply to image journals and assessment-community interactions.
- Accepted media is static JPEG, PNG, or WebP only. SVG, GIF, animated images, HEIC, remote URLs, corrupt files, spoofed MIME types, files over 8 MiB, and images over 25 MP are rejected.
- Processing rotates to the correct orientation, converts to sRGB, removes EXIF/GPS/device/original-filename metadata, creates 320/960/1600 pixel WebP variants, and discards the original upload.
- Per-account limits are 20 uploads per day, 3 public publications per day, and 250 MiB of stored processed variants. Quotas and fixed one-minute request windows persist in SQLite; rate-limit keys are stored only as SHA-256 digests rather than raw IP or account identifiers.
- The first image-journal release has no Markdown, HTML, video, filters, stickers, free canvas, remote media, automatic translation, or runtime AI image generation.
- Chinese and English are the product UI languages. User-authored journal content records its selected language but does not require bilingual copies.
- The canonical production root is `https://knowyourself.cc.cd/`; `loveyourself.cc.cd` is redirect-only.
- Storage v3, existing assessment scoring, and cloud synchronization contracts remain compatible. Image URLs are not stored in `QuizResult` or historical assessment records.

## Brand Commitments

- Product name: `认识你自己 | Know Yourself`.
- Voice: calm, honest, humane, non-judgmental, and concise.
- Results must never be framed as diagnosis, therapy, or medical advice.
- Images should clarify or hold an observation, not replace complete text, pressure a user to interpret a metaphor, or turn reflection into a gamified identity.
- Visual craft should reduce anxiety, protect focus, improve comprehension, and make completion feel considered. It must not add spectacle, delay, or interaction ambiguity merely to make the product look more impressive.
- Public authorship uses the account display name. Privacy, publishing state, and moderation state must remain legible in the interface.

## Evidence on Hand

- 193 existing bilingual assessment modules, with 16 reviewed definitions exposed through the public catalog.
- Four assessment pilots with 20 local WebP cover/result visuals and bilingual alt text.
- Registry, scoring, quiz-media, Storage v3, cloud-revision, community, journal, governance, and share test scripts.
- Only aggregate result-image helpfulness feedback exists today. There is no complete behavioral funnel or retention baseline yet.
- No testimonials, clinical validation claims, customer logos, or usage statistics are available and none should be invented.

## Goals and Success Measures

The working north-star measure is **28-day meaningful return rate**: the share of people who complete a meaningful reflection on at least two different days within 28 days.

A meaningful reflection begins with a completed assessment and includes at least one intentional continuation: privately saving an observation, recording a next action, reviewing or comparing history, or beginning a relevant follow-up assessment. A public share alone does not count, because distribution is not proof that the user received lasting value.

The first product stage must establish a trustworthy baseline for:

- Assessment discovery to detail-view rate.
- Detail view to assessment-start rate.
- Start to completion rate, segmented by assessment length, language, and device class.
- Result comprehension and depth of result-page engagement.
- Result to meaningful private follow-up rate.
- Return on a second day within 7 and 28 days.

The second stage must prove that history, private reflection, related assessments, and retake comparison improve meaningful return.

Community expansion requires separate evidence: result-to-discussion entry, relevant contribution rate, useful-response rate and time, incremental return compared with similar non-participants, and acceptable privacy regret, report, and moderation costs. Post count, likes, and raw time on page are not sufficient decision metrics.

Exact behavioral targets remain open until the first complete baseline is measured. Reliability, accessibility, privacy, and performance remain release gates rather than optimization metrics.

## Non-Goals

- Maximizing the number of public assessments, posts, likes, badges, or minutes spent in a feed.
- Becoming a generic social network, image publishing platform, or creator-audience product.
- Treating public community participation as the default or required path to retention.
- Using assessment results as clinical claims, employment guidance, or stable identity categories.
- Expanding sensitive assessments without matching safeguards, limitations, and recovery language.
- Pursuing visual novelty at the expense of comprehension, control, accessibility, or completion.
- Building more community infrastructure before the assessment-to-private-return loop is validated.

## Product Principles

1. Assessments are the primary path to first value; open expression and community are optional continuations.
2. A result must improve understanding and suggest a next step, not merely produce a label.
3. Earn private continuity before asking for public participation. Nothing personal becomes public without an explicit, inspectable action.
4. Organize community around relevant assessment and reflection context rather than an undifferentiated feed.
5. Trust, comprehension, completion, and user control outrank novelty, engagement theater, or visual spectacle.
6. Let measured behavior decide whether a feature or community surface expands; do not use content volume as a proxy for value.
7. Keep personal data understandable and portable, and prefer one coherent source of truth across storage, scoring, and publishing.

## Accessibility & Inclusion

The core flows must work with keyboard navigation, visible focus, reduced motion, responsive layouts, 200% zoom, and sufficient contrast. Assessment visuals require bilingual alt text while user media requires author-provided alt text or an explicit decorative choice. Image ordering must not depend on drag alone. Chinese and English navigation, state, recovery, and moderation language must remain equivalent.

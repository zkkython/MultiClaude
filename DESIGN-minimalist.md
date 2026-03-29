# Design System: MultiClaude Minimal Editorial

## 1. Visual Theme & Atmosphere
MultiClaude should feel like a focused technical notebook: flat, quiet, and deliberate.  
Density is **6/10 (Daily App Balanced)**, variance is **5/10 (Offset Asymmetric)**, and motion is **4/10 (Static Restrained to Fluid CSS)**.  
Favor macro-whitespace, strict 1px structure, and text-first hierarchy over decorative UI.

## 2. Color Palette & Roles
- **Warm Canvas** (`#F7F6F3`) - Global app background.
- **Paper Surface** (`#FFFFFF`) - Main panels and modal shells.
- **Soft Surface** (`#F9F9F8`) - Secondary strips and grouped regions.
- **Hairline Border** (`#EAEAEA`) - All structural lines and card borders (1px only).
- **Primary Ink** (`#2F3437`) - Main text and key labels.
- **Secondary Ink** (`#787774`) - Metadata and helper text.
- **Muted Ink** (`#9A9893`) - Disabled and tertiary labels.
- **Graphite Accent** (`#111111`) - Single accent for primary actions and selected state.
- **Pale Red** (`#FDEBEC`) - Error tint surface (text `#9F2F2D`).
- **Pale Blue** (`#E1F3FE`) - Informational tint surface (text `#1F6C9F`).
- **Pale Green** (`#EDF3EC`) - Success tint surface (text `#346538`).
- **Pale Yellow** (`#FBF3DB`) - Warning tint surface (text `#956400`).

Rules:
- One accent only: `#111111`.
- No neon, gradients, or saturated hero backgrounds.
- No pure black (`#000000`).

## 3. Typography Rules
- **Display:** `Instrument Serif` - tight tracking (`-0.03em`), line-height `1.1`, used only for major headings/onboarding.
- **UI/Body:** `Geist Sans` - 400/500/600 weights, line-height `1.6`, max content width `65ch`.
- **Mono/Data:** `Geist Mono` (fallback `JetBrains Mono`) - runtime metrics, tabs, IDs, shortcuts.
- **Scale guidance:**  
  `display: clamp(1.75rem, 2.8vw, 2.8rem)`  
  `h2: clamp(1.2rem, 1.6vw, 1.5rem)`  
  `body: 0.95rem` minimum.

Banned:
- `Inter`, `Roboto`, `Open Sans`
- Generic serif families (`Times New Roman`, `Georgia`, `Garamond`, `Palatino`)

## 4. Hero Section Rules
Use hero treatment only for onboarding/overview, not active terminal panes.

- Asymmetric two-column composition; never centered hero.
- Inline visual inserts in headline are allowed, but keep flat framing and no overlap.
- Maximum one primary CTA.
- No filler cues like scroll arrows or “Scroll to explore”.

## 5. Component Stylings
- **Buttons:** Primary is solid graphite (`#111111`) with white text, radius `4px-6px`, no shadow. Hover darkens subtly; active uses `scale(0.98)` or `translateY(1px)`.
- **Cards/Panels:** Flat only; all cards use `border: 1px solid #EAEAEA`. Radius `8px` or `12px` max. No heavy shadows.
- **Tabs:** Mono labels, flat strips, active indicated by text emphasis + 1px divider contrast, not glow.
- **Inputs/Forms:** Label above, helper optional below, error text below. Focus ring is neutral graphite outline.
- **Badges/Tags:** Pastel-backed micro-labels, uppercase tracking (`0.05em`), small type.
- **Keystrokes:** `<kbd>` style with 1px border, warm background (`#F7F6F3`), monospace text.
- **Loaders:** Skeleton placeholders matching final geometry; no circular spinner default.

## 6. Layout Principles
- Grid-first, with bento asymmetry where helpful; avoid equal three-column feature rows.
- Constrain readable content to `max-width: 72rem` (`~1152px`) for editorial sections.
- Preserve 1px structural rhythm (`#EAEAEA`) across all section boundaries.
- Use `min-height: 100dvh` for full-height zones.
- Spacing cadence:
  `4, 8, 12, 16, 24, 32, 40, 56, 72` px.

## 7. Responsive Rules
- Density calibration breakpoints: `<=1200px`, `<=1024px`, `<=900px`, `<=768px`, `<=640px`.
- Collapse all multi-column layouts below `768px`.
- No horizontal overflow on mobile.
- Preserve touch targets at `44px` minimum.
- Narrow widths prioritize action controls; truncate metadata first in status regions.
- Vertical spacing scales with `clamp(2.5rem, 7vw, 5.5rem)`.

## 8. Motion & Interaction
- Keep motion subtle and nearly invisible.
- Entry animations: `translateY(12px)` + fade, `600ms`, `cubic-bezier(0.16, 1, 0.3, 1)`.
- Stagger list/grid items with `80ms` increments.
- Hover lift is minimal (`0 2px 8px rgba(0,0,0,0.04)` max).
- Animate only `transform` and `opacity`.
- No animated layout properties (`top`, `left`, `width`, `height`).

## 9. Anti-Patterns (Banned)
- No emojis.
- No `Inter`, `Roboto`, or `Open Sans`.
- No generic thin-line icon defaults (Lucide/Feather/Heroicons-only look).
- No heavy drop shadows.
- No gradients or neon effects.
- No pill-shaped large containers or pill primary buttons.
- No overlapping content layers.
- No generic placeholder names (for people or companies).
- No AI marketing clichés (“Elevate”, “Seamless”, “Unleash”, “Next-Gen”).
- No fake round metrics unless backed by real data.

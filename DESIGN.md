# Design System: MultiClaude Control Room

## 1. Visual Theme & Atmosphere
MultiClaude should feel like a precision operator console: calm, data-forward, and intentional, with restrained visual drama.  
Density is **7/10 (Daily App Balanced leaning Cockpit Dense)**, variance is **6/10 (Offset Asymmetric)**, and motion is **5/10 (Fluid CSS, restrained)**.  
Use dark neutral surfaces, tight information grouping, and clear status contrast so users can manage many terminals without visual fatigue.

## 2. Color Palette & Roles
- **Deep Canvas** (`#0F1115`) - Global app background (never pure black).
- **Panel Graphite** (`#161A21`) - Sidebar, tab strips, secondary panels.
- **Raised Slate** (`#1D2330`) - Active panes, focused cards, modal shells.
- **Divider Steel** (`#2A3242`) - Structural borders and separators (1px).
- **Primary Ink** (`#E6EAF2`) - Main text and high-priority labels.
- **Secondary Ink** (`#9AA4B5`) - Metadata, helper text, quiet labels.
- **Muted Ink** (`#6F7B90`) - Disabled states and tertiary annotations.
- **Signal Amber** (`#C99A3D`) - Single accent for primary CTA, focus ring, active indicator.
- **State Success** (`#4FAE74`) - Success and healthy runtime state.
- **State Warning** (`#D2A24C`) - Caution, preflight warnings.
- **State Error** (`#CC5A5A`) - Error and destructive actions.

Rules:
- Max one accent color for interaction emphasis: `#C99A3D`.
- No purple/blue neon glow aesthetics.
- No warm/cool neutral mixing across screens.

## 3. Typography Rules
- **Display/UI Headline:** `Geist` - 600 weight, tight tracking (`-0.02em`), hierarchy by weight and color, not oversized jumps.
- **Body/UI Text:** `Geist` - 400/500 weight, line-height `1.45`, body max line length `65ch`.
- **Mono/Data:** `JetBrains Mono` - tabs, runtime metrics, terminal metadata, IDs, and all numeric clusters in dense panels.
- **Dashboard Constraint:** Sans + mono only (`Geist` + `JetBrains Mono`).
- **Scale guidance:**  
  `display: clamp(1.5rem, 2.2vw, 2.25rem)`  
  `h2: clamp(1.125rem, 1.4vw, 1.375rem)`  
  `body: 0.9375rem` minimum; never below `0.875rem`.

Banned:
- `Inter`
- Generic serif families (`Times New Roman`, `Georgia`, `Garamond`, `Palatino`)

## 4. Hero Section Rules
Use hero treatment only for onboarding/overview surfaces, not operational panes.

- Use asymmetric split layout (content left, contextual visual right).
- Signature technique: inline visual chips/images embedded between headline phrases, sized to cap-height and rounded (`12px` radius).
- Never overlap headline text and imagery; each element has distinct spatial ownership.
- Maximum one primary CTA.
- No filler prompts like "Scroll to explore" or chevron bounce cues.
- Centered hero composition is banned for this project.

## 5. Component Stylings
- **Buttons:** 10px radius, flat fill, no outer glow. Primary uses `Signal Amber`; active state uses tactile press (`transform: translateY(1px)` + slight darken). Ghost/outline for secondary actions.
- **Cards/Panels:** Use elevation only when hierarchy changes. Prefer border-led sections (`1px Divider Steel`) over stacked shadow cards in dense workspace zones.
- **Tabs:** Compact horizontal rhythm (`32-40px` height), mono-friendly labels, active tab indicated by accent edge treatment (2px) and tinted active surface, never by glow.
- **Inputs/Forms:** Label above field, optional helper text below, error text directly under input. Focus ring uses `Signal Amber` with 2px outside ring.
- **Loaders:** Skeleton bars and blocks matching final geometry; shimmer uses low-contrast sweep. No circular spinner as default page loader.
- **Empty States:** Show a composed mini-layout (icon + next step + one action), not single-line "No data".
- **Error States:** Inline, specific, and local to failing area; include direct recovery action.

## 6. Layout Principles
- Grid-first structure; avoid percentage hack layouts and `calc()` for primary geometry.
- Main app container max width: `1400px` when centered contexts are used (preferences/modals/docs). Workspace views may span full width.
- Use asymmetric pane distribution when >2 simultaneous work regions.
- Replace "three equal cards in a row" with zig-zag pairs, split-density panels, or horizontal scrollers.
- No overlapping content blocks or absolute-stacked text overlays.
- Full-height sections use `min-height: 100dvh`; never `h-screen`.
- Spacing cadence:
  `4, 8, 12, 16, 24, 32, 48, 64` px only.

## 7. Responsive Rules
- Density calibration breakpoints: `<=1200px` (tab compaction), `<=1024px` (workspace pane collapse + form/grid collapse), `<=900px` (sidebar + status compression), `<=768px` (further tab tightening), `<=640px` (status simplification).
- Mobile-first collapse below `768px`: all multi-column layouts are single-column.
- No horizontal overflow on mobile; this is a release blocker.
- Header text and section titles scale with `clamp()`.
- Interactive targets are minimum `44px` height/width.
- Inline hero images move below headline on mobile.
- Desktop horizontal navigation collapses to compact menu drawer.
- Vertical section spacing scales with `clamp(3rem, 8vw, 6rem)`.
- Status bar rule on narrow widths: preserve actionable controls, truncate or hide low-priority metadata first.

## 8. Motion & Interaction
- Default spring profile: `stiffness: 100`, `damping: 20`.
- Use staggered reveals for tab lists, config lists, and panel stacks (`40-70ms` incremental delay).
- Default UI transition curve for micro-interactions: `cubic-bezier(0.22, 1, 0.36, 1)` around `220ms`.
- Keep perpetual micro-motion subtle and functional (status pulse, shimmer, breathing focus ring) on active surfaces only.
- Animate only `transform` and `opacity`.
- Never animate `top`, `left`, `width`, or `height`.
- Heavy grain/noise effects must live on fixed pseudo-elements and remain low opacity.

## 9. Anti-Patterns (Banned)
- No emojis in UI copy.
- No `Inter` font.
- No generic serif fonts in any software/dashboard screen.
- No pure black (`#000000`).
- No neon or outer-glow shadows.
- No oversaturated accent colors.
- No large gradient headline text.
- No custom mouse cursors.
- No overlapping elements or text-on-text stacking.
- No three-equal-column feature card rows.
- No generic placeholder names like "John Doe", "Acme", or "Nexus".
- No fake round metrics like `99.99%` or `50%` unless backed by real data.
- No AI cliché copy ("Elevate", "Seamless", "Unleash", "Next-Gen").
- No filler UI text ("Scroll to explore", "Swipe down", bouncing arrows).
- No broken Unsplash links; use `picsum.photos` or local/SVG assets.
- No centered hero layout for this design system.

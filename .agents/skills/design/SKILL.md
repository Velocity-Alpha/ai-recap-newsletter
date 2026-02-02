---
name: design
description: Design philosophy and design tokens for the AI Recap Newsletter project.
---

# AI Recap Design System

## Philosophy

**Editorial, not startup.** We're a daily briefing, not a SaaS product. Think *Monocle* meets *Morning Brew* — authoritative, warm, handcrafted.

**Watercolor soul.** Our illustrations use loose watercolor washes in muted blues, rusts, and sages. The UI should feel like it belongs alongside them — soft edges, organic warmth, zero corporate sterility.

**Quiet confidence.** Let typography and whitespace do the work. Color supports structure and action, never decoration.

---

## Tailwind & CSS Tokens

This project uses **Tailwind CSS 4**. Most tokens are defined as CSS variables in [app/globals.css](app/globals.css) and are automatically available via Tailwind utilities or as `var(--token-name)`.

### Backgrounds
| Token | Hex | Tailwind Utility | Usage |
|-------|-----|------------------|-------|
| `--bg-main` | `#FAFAF8` | `bg-background` | Page background (warm paper) |
| `--bg-warm` | `#F7F6F3` | `bg-secondary` | Section alternation, inputs |
| `--bg-card` | `#FFFFFF` | `bg-card` | Cards, elevated surfaces |

### Text
| Token | Hex | Tailwind Utility | Usage |
|-------|-----|------------------|-------|
| `--text-primary` | `#2C3E4A` | `text-foreground` | Headlines, body copy |
| `--text-secondary` | `#5A6B78` | `text-secondary` | Descriptions, metadata |
| `--text-muted` | `#8A9BA8` | `text-muted-foreground` | Captions, timestamps, labels |

### Watercolor Palette
Use these for accents and decoration. They are available as standard CSS variables.

| Token | Hex | Character |
|-------|-----|-----------|
| `--watercolor-blue` | `#A8C5D9` | Cool, calm — product tags |
| `--watercolor-blue-deep` | `#6B9BB8` | Stronger blue moments |
| `--watercolor-rust` | `#C4A484` | Warm, earthy — funding tags |
| `--watercolor-rust-deep` | `#B8956E` | Richer terracotta |
| `--watercolor-sage` | `#9DB4A0` | Organic, trustworthy — policy tags |
| `--watercolor-ink` | `#3D4F5F` | Deep contrast — subscribe section |

### Functional
| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `--accent-primary` | `#5A7A8A` | `color-primary` | Links, secondary actions |
| `--accent-warm` | `#B8856E` | - | Live indicators, primary CTAs |
| `--border` | `#D4DDE3` | `border-border` | Visible dividers |
| `--border-light` | `#E8EDF0` | `border-muted` | Subtle separators |

---

## Typography

### Fonts
| Role | Family | Token | Tailwind Utility |
|------|--------|-------|------------------|
| Display | Libre Baskerville | `--font-serif` | `font-serif` |
| Body/UI | Source Sans 3 | `--font-sans` | `font-sans` |

### Style Rules
- **Serif** for editorial content: headlines, card titles, pull quotes. Use `font-serif`.
- **Sans** for UI: buttons, navigation, labels, body copy. Use `font-sans`.
- **Never uppercase serif.** Uppercase is reserved for sans-serif labels/tags only.

---

## Spacing & Layout

Spacing tokens map to rem values for consistency:

| Token | Value | Tailwind Usage |
|-------|-------|----------------|
| `--space-xs` | 8px (0.5rem) | `p-[var(--space-xs)]` |
| `--space-sm` | 16px (1rem) | `gap-4` or `gap-[var(--space-sm)]` |
| `--space-md` | 24px (1.5rem) | `p-6` or `p-[var(--space-md)]` |
| `--space-lg` | 40px (2.5rem) | `my-10` or `my-[var(--space-lg)]` |

---

## Radius & Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | 4px | Buttons, inputs, tags (`rounded`) |
| `--radius-lg` | 8px | Cards, modals (`rounded-lg`) |

### Shadows
Defined in components, not as global Tailwind tokens yet.
- **Card**: `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)`
- **Elevated**: `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 20px 48px rgba(0,0,0,0.08)`

---

## Watercolor Animation Patterns

Use these classes for the signature watercolor feel:

```css
/* Signature Watercolor Blob */
.watercolor-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.12;
  pointer-events: none;
}
```

- **Avoid saturated colors**: Never use default Tailwind blues or reds.
- **Background**: Always default to `--bg-main` (#FAFAF8).

---

## Do / Don't

### Do
- Use `font-serif` for headlines.
- Use `bg-background` for the main page.
- Apply watercolor tones as subtle accents.

### Don't
- Uppercase serif type.
- Use sharp corners (min 4px radius).
- Overuse shadows.

---

## Brand Voice (for reference)

**Tone**: Informed, concise, subtly warm. A knowledgeable colleague, not a hype machine.

**Headlines**: Declarative, present-tense. *"Anthropic closes $3B round"* not *"Anthropic has just closed..."*

**CTAs**: Direct but unhurried. *"Subscribe free" / "Full briefing →"*

---

*Last updated: February 2026*

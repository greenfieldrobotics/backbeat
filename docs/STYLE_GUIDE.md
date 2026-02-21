# Backbeat / Stash — UI Style Guide

> **Purpose:** Provide Claude Code with concrete design tokens and rules for implementing
> the Backbeat UI consistent with the GreenField Robotics brand.
>
> **Source:** GreenField Brand Bible (2024)

---

## Colors

| Name | Hex | CSS Variable | Usage |
|---|---|---|---|
| Teal | `#009D9A` | `--color-teal` | Primary brand color. Sidebar, headers, primary buttons, links, active states |
| Yellow | `#FFC433` | `--color-yellow` | Accent/highlight. Alerts, badges, progress bars, hover states, bottom border stripe |
| Yellow Dark | `#FFBD33` | `--color-yellow-dark` | Secondary accent. Button hover, warning states |
| White | `#FFFFFF` | `--color-white` | Backgrounds, text on teal/dark surfaces |
| Dark Text | `#1A1A1A` | `--color-text` | Primary body text |
| Light Gray | `#F5F5F5` | `--color-bg-light` | Page background, alternating table rows |
| Mid Gray | `#E0E0E0` | `--color-border` | Borders, dividers, input outlines |

### Color Rules
- Teal is the dominant UI color — use it for the sidebar, navigation, and primary actions
- Yellow is accent only — never use it as a background for large areas
- Avoid red/green for status unless paired with an icon or text label (accessibility)
- For status indicators: teal = active/good, yellow = warning/attention, gray = inactive/closed

---

## Typography

| Role | Font | Weight | Size | CSS Variable |
|---|---|---|---|---|
| Headings (h1–h3) | Kumbh Sans | 700 (bold) | h1: 24px, h2: 20px, h3: 16px | `--font-heading` |
| Body text | Kumbh Sans | 400 (regular) | 14px | `--font-body` |
| Labels / captions | Kumbh Sans | 500 (medium) | 12px | `--font-label` |
| Monospace (data) | System monospace | 400 | 13px | `--font-mono` |

### Font Rules
- Use **Kumbh Sans** from Google Fonts (it is the web equivalent of Glacial Indifference, the brand font)
- Import: `@import url('https://fonts.googleapis.com/css2?family=Kumbh+Sans:wght@400;500;700&display=swap');`
- Use monospace for part numbers, PO numbers, quantities, and cost values
- Headings are teal (`#009D9A`). Body text is dark (`#1A1A1A`)

---

## Component Patterns

### Sidebar Navigation
- Background: teal (`#009D9A`)
- Text: white, no underlines
- Active item: white background with teal text (or white text with yellow left border)
- App title "Backbeat" in bold, module badge "Stash" in yellow

### Buttons
- **Primary:** Teal background, white text, 4px border radius
- **Secondary:** White background, teal border, teal text
- **Danger:** Use sparingly — teal outline with "Dispose" / "Delete" label is sufficient; avoid bright red
- **Disabled:** Gray background, muted text

### Tables
- Header row: teal background, white text, bold
- Alternating row stripes: white / light gray (`#F5F5F5`)
- Borders: 1px `#E0E0E0`
- Right-align numeric columns (quantities, costs)
- Monospace font for part numbers and cost values

### Forms
- Labels above inputs, medium weight, 12px
- Input borders: `#E0E0E0`, focus border: teal
- Required field indicator: yellow asterisk
- Error messages: below the field, teal text (not red — brand consistency)

### Cards / Panels
- White background, 1px `#E0E0E0` border, 8px border radius
- Optional: thin teal top border (2px) for emphasis
- Padding: 16px

### Badges / Status Pills
- Small rounded pill shape (12px font, 4px vertical padding, 8px horizontal, 12px border radius)
- PO statuses: Draft = gray, Ordered = teal, Partially Received = yellow text on light yellow bg, Closed = muted gray
- ISSUE flag: yellow background, dark text, visible on inventory rows

---

## Naming Conventions (Brand Language)

| Do | Don't |
|---|---|
| GreenField (camelCase F) | Greenfield, Green Field, greenfield |
| GreenField Robotics (in formal / press contexts) | GreenField Robotics Inc. |
| GREENFIELD (all caps on hardware/bots only) | GREENFIELD in software UI |
| BOTONY© (always with ©, always caps) | Botony, botony |
| "regenerative" | "sustainable" |
| BOTONY© fleet / BOTONY© line | BOTONY bots (noun) — BOTONY is an adjective only |

---

## Tone (for UI Copy, Labels, Messages)

- **Positive** — frame messages around what happened, not what went wrong
  - "3 units received at Warehouse" not "Receipt processed"
- **Actionable** — tell the user what to do next
  - "Select a PO to receive against" not "No PO selected"
- **Forward-looking** — emphasize outcomes
  - "Inventory updated — 7 units remaining" not "Transaction complete"
- **Not whiny** — error messages are direct and helpful
  - "Insufficient inventory. Available: 5, Requested: 10" not "Error: cannot process request"

---

## Layout

- Sidebar on the left (fixed width, ~220px)
- Main content area fills remaining width
- Max content width: 1200px, centered if viewport is wider
- Responsive: sidebar collapses to hamburger menu below 768px
- Consistent page header pattern: page title (h1, teal) + optional subtitle/description

---

## CSS Variable Template

```css
:root {
  /* Colors */
  --color-teal: #009D9A;
  --color-yellow: #FFC433;
  --color-yellow-dark: #FFBD33;
  --color-white: #FFFFFF;
  --color-text: #1A1A1A;
  --color-bg-light: #F5F5F5;
  --color-border: #E0E0E0;

  /* Typography */
  --font-family: 'Kumbh Sans', sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  --font-size-h1: 24px;
  --font-size-h2: 20px;
  --font-size-h3: 16px;
  --font-size-body: 14px;
  --font-size-label: 12px;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* Borders */
  --border-radius: 4px;
  --border-radius-lg: 8px;
  --border-radius-pill: 12px;
  --border-color: #E0E0E0;
}
```

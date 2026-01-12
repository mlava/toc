# Table of Contents for Roam Research

If you do a lot of long-form writing or reading in **Roam Research**, navigating large pages can quickly become frustrating. **Table of Contents (TOC)** adds a fast, floating, and intelligent outline of your page headings — always visible, always in sync.

---

## ✨ What this extension does

- Scans the current page for headings (H1–H6)
- Builds a **floating, sticky Table of Contents** alongside your page
- Keeps the TOC **live-updated** as you edit (optional)
- Lets you **jump instantly** to any section
- Works well with common Roam workflows (Daily Notes, sidebar, themes, keyboard navigation)

You can open the TOC via:
- **Command Palette** → *Create a Table of Contents (toc)*
- **Topbar button** (toggle on/off)

---

## 🧭 Using the TOC

### Basic navigation
- **Click a heading** → scrolls the page to that heading
- **Shift-click a heading** → opens that block in the **right sidebar**

### Active heading highlight
As you scroll the page, the TOC highlights the **currently visible heading**, helping you keep your place in long documents.

---

## 🔄 Live updates while editing (Auto-refresh)

When *Auto-refresh* is enabled (default):

- Adding, removing, or changing headings updates the TOC automatically
- Switching heading levels (H1 → H2, etc.) is reflected instantly
- No manual refresh required

This uses Roam’s pull-watch API and debounced rebuilds for performance.

---

## 🧠 Smart filtering & performance safeguards

### Filter box
If enabled, a filter input appears at the top of the TOC:
- Type to quickly narrow down headings
- Helpful for very long pages

### Ignored subtrees (automatic)
The TOC automatically ignores certain widget-style blocks (and their subtrees), including:
- Better Tasks dashboards (**Today**, **Overdue**, **Upcoming**, **Inbox**)
- Embedded blocks that resolve to those widgets

This prevents noisy or irrelevant sections from polluting your TOC.

---

## 📌 Persistence (per page)

### Remember TOC open / closed state
When enabled:
- The TOC remembers whether it was open or closed **per page**
- Stored in the page’s block properties
- Restored automatically when you return to that page

### Remember scroll position (optional)
When enabled:
- The TOC remembers the **last visible heading** you were reading
- On reopening the page, the TOC can restore the active heading and scroll you back to that section

There are safety guards to avoid fighting with:
- Manual scrolling
- Clicking TOC items
- Page navigation and layout changes

---

## 🧩 Compatibility

### Augmented Headings
- Compatible with the **Augmented Headings** extension
- Supports H4–H6 levels via tagged headings
- Attempts to style those levels to match your current theme

### Themes & CSS
- TOC heading styles (font size, weight, color) are derived from your current theme where possible
- Works well with Roam Studio and other custom themes
- If you switch themes mid-session, rebuild the TOC

### Keyboard navigation
- The topbar button supports keyboard activation (Enter/Space)
- TOC filter input (if enabled) is keyboard-friendly

---

## ⚙️ Settings

All settings are available under **Roam Depot → Extension Settings → TOC**.

### General
- **Enable filter box** – Show/hide the TOC search input
- **Auto-refresh TOC while editing** – Live updates when headings change
- **Resolve ((block refs)) in headings** – Converts block refs to text (slower on very large pages)
- **Exclude headings** – Comma-separated list of heading text to exclude (case-insensitive “contains” match)
- **Respect page filters** – Applies the page’s includes/removes rules when building the TOC  
  - *Remove* behaves like Roam: it hides the matching block **and its descendants**, even if the removed block isn’t a heading.
  - Page filters are checked periodically while the TOC is open.

### Appearance
- **TOC max width** – Any CSS width (e.g. `250px`, `20rem`)
- **TOC max height** – Any CSS height (e.g. `calc(100vh - 90px)`)

Both settings are clamped to safe limits to avoid layout issues.

### Persistence
- **Remember TOC open/closed per page** – Stores TOC state in page properties
- **Remember scroll position per page** – Stores the last visible heading and restores it

---

## 🔒 Safety & performance notes

- Observers, timers, and listeners are cleaned up on unload
- Page-property writes are queued to avoid clobbering concurrent updates
- Embedded block inspection is cached with a soft cap to prevent memory growth
- Scroll persistence is gated to avoid fighting user input

---

## 🧪 Known limitations

- Very large pages with thousands of blocks may rebuild more slowly, especially if block-ref resolution is enabled
- Scroll restoration may not work if the target heading is inside a deeply collapsed region

---

## 🚀 Roadmap (ideas)

- Optional per-graph ignored subtree configuration
- Keyboard navigation within the TOC
- Collapsible TOC sections for deeply nested documents

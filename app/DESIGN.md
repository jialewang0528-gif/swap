# Swap design system (core)

Owner of `core.css`, `core.js`, `data.js`, `index.html`. Feature authors build on these and do not edit them.

## Hard rules
- Non-AI look: no sparkles, glows, purple-gradient haze, emoji, eyebrow labels above headings, gradient text, or grids of identical icon + heading + text cards.
- Copy is label + number. No guilt, no "over budget", no peer dollar comparisons.
- Night rides (11 PM to 6 AM, or tagged night) are counted and are never a swap target (never suggest skipping, walking or the subway at night). The lower-fare ride app is never suggested on public or sample profiles. Exception: the founder's private build (`api.rideAppAllowed()`), where it is recommended over Uber/Lyft, including as a cheaper app for night rides.
- Every number is REAL or labeled sample. One small badge per screen, from `api.badge(field)`. Live "You" (private/live.js) is real everywhere: `api.badge()` returns "" and no screen may say "sample", "prototype" or "scripted demo" for it.
- Reduced motion = opacity cross-fade. `api.animate` already does this. Do not write your own movement without it.
- One signature motion per screen (Week: guess reveal; Swaps: deck fling; Wallet: stack expand; Chat: first answer card). Everything else gets quiet feedback under 250ms.

## Tokens (`:root` in core.css)
- **Neutrals:** `--ink` (text, primary buttons, selected tab, focus ring), `--ink-2`, `--ink-3`, `--ink-4` (control borders), `--hair`, `--fill`, `--fill-2`, `--canvas`, `--surface`, `--surface-2`, `--sheet-bg`.
- **4 hues**, each `base / -soft / -ink`. Base fills are 3:1 or better on white.
  - `--food`: orange
  - `--move`: blue (getting around only)
  - `--night`: purple. Always pair it with `--night-pattern` (hatched) or the moon icon, so it is never color-only.
  - `--accent`: green (saved, room, done). It is never blue and never "move". `--mint*` are legacy aliases for it.
  - At most 3 hues on one screen. No raw hex in feature CSS.
- **Radius:**
  - `--r-pill` 999: buttons, chips, capsules
  - `--r-card` 26: cards
  - `--r-tile` 16: tiles inside a card
  - `--r-well` 10: icon wells
  - `--r-badge` 6: badges
  - Nested corners are concentric: inner = outer − padding.
- **Spacing (4pt grid):** `--s-1..--s-11` (4/8/12/16/20/24/32/44), `--gutter` 16, `--tap` 44 (minimum touch target).
- **Type (1rem = the reader's body size: 17px by default; on iPhone, `html { font: -apple-system-body }` makes it follow Settings > Text Size). Use rem for every font size; layouts must hold at 200% (test with `html{font-size:34px}` at 320px wide). Money numerals are `min(rem, vw)` so they never overflow the phone.**

  | Class | px | Weight |
  |---|---|---|
  | `.t-largetitle` | 34 | 700 |
  | `.t-title` | 28 | 700 |
  | `.t-title2` | 22 | 700 |
  | `.t-title3` | 20 | 600 |
  | `.t-headline` | 17 | 600 |
  | `.t-body` | 17 | 400 |
  | `.t-sub` | 15 | 400 |
  | `.t-foot` | 13 | 400 |
  | `.t-cap` | 11 | 600 |

  - `.t-2` and `.t-3` set secondary colors.
  - Money: `.n-xl` 64, `.n-l` 40, `.n-m` 28 (SF Rounded 700, tabular). Inline amounts use `.num`.
  - Never use weight 800 and never use negative tracking on text.
- **Materials:**
  - `.card`: solid white with `--shadow-card`. Use it for ALL content.
  - `.glass`: Liquid Glass. Use it ONLY on floating controls: tab bar, nav buttons, sheet chrome, toast, composer, deck buttons.
- **Springs:** `api.springs = { snappy (440/36, press), standard (220/24, moves), gentle (170/26, sheets/reveals) }`. CSS gets the same curves as `var(--ease-snappy|standard|gentle)` and `var(--dur-…)`. `--fade` is 150ms.

## Components (core.css)
- **Surfaces:** `.card`, `.card.hero`, `.card.flat`, `.tile`, `.pressable` (scale .97 on press).
- **Lists:** `.list` / `.row`, with `.grow` and `.amt` inside a row. One line per item: name left, amount right.
- **Section titles:** `.section-title` (20/600, optional `<small>`). It names the content ("By day"), never the feature.
- **Buttons:** `.btn` plus `.primary`, `.secondary`, `.tint`, `.accent`, `.plain` or `.glassy` (floating only), with `.block` and `.small` modifiers. `.icon-btn` is 44px.
- **Chips:** `.chip` is 34px with a 44px hit area. State uses `aria-pressed` or `aria-checked`.
- **Category marks:**
  - `.dot.food`, `.dot.move` (round), `.dot.night` (hatched)
  - `.fill-food`, `.fill-move`, `.fill-night` for bars
  - `.kind.food`, `.kind.move`, `.kind.night`, `.kind.saved` icon wells (`.lg` = 40px)
- **Badges:** `.real` / `.sample` (or `.badge.real` / `.badge.sample`).
- **Choice rows:** `.choices` > `.choice[role=radio]` (single-choice lists).
- **Hidden text:** `.vh` (visually hidden).

## Shell behavior (do not rebuild)
- Each tab has a large title (`h1`) plus a `.lt-sub` line. On scroll it collapses into a compact title on an opaque blurred bar (content never shows through it). The tab bar shrinks on scroll-down, except on Chat. Tapping the active tab scrolls to the top.
- The **You** avatar (top right, every tab, `[data-profile-btn]`) opens the You sheet: Weekly save (stepper + presets, live cap), Reminders, Where you live (the 4 answers), Whose data, Set up again. Do not add your own profile pill or settings entry; call `api.openYou(section)`.
- **One sheet chrome:** Back chevron top-left only on multi-step sheets (`handle.setBack(fn)` / `api.sheetBack(body, fn)`, `null` on the first step), Close X top-right always, one primary action at the bottom via `sheetActions`. No Back or Done in the bottom bar. Onboarding uses the same: Back left, X right.
- A feature whose render throws shows "This part didn't load" with Try again, instead of a blank tab.
- Views are `role=tabpanel`. Inactive views are `inert`.
- **Feature slots:** your slot sits under the large title, so don't add your own page header. Gutter is 16px: use `margin: 0 -16px` for edge-to-edge strips.

## api additions
- **Profiles:**
  - `api.profile()` returns `"you" | "mealplan" | "social"`.
  - `api.setProfile(id)` switches profiles.
  - `api.profiles()` returns `[{ id, label, short, source, blurb, active }]`.
  - Switching fires `swap:profile` on `document`.
  - **Default:** core re-renders your slot on switch. `render()` may return a `dispose()` function, and core calls it first.
  - Set `profileAware: true` in your feature definition only if you handle `swap:profile` yourself.
- **`api.data`** always returns the active profile. It has the same field names as before, plus:
  - `facts { hasMealPlan, kitchen: none|micro|shared|own, subwayMinutes (null = no subway), lateNights, moved }`
  - `mealPlan` (null if none)
  - `real` (the list of REAL fields; check with `api.isReal("weekly")`)
  - `source` (`"real"` | `"sample"`)
  - `charges[].split { people, back }` (Venmo paybacks; totals stay at card price)
  - `thisWeek.paidBack`
  - `move.afterLabel`. Social has `move.date: null` and `facts.moved: false`.
- **`api.facts()`** returns the active facts. For "you", Move-in answers (store `moveProfile`) override the defaults and fire `swap:facts`.
- **`api.setSave(amount)`** sets the active profile's weekly save target (store `saveTarget`), recomputes `thisWeek.cap`, re-renders features and fires `swap:profile`. Saved targets are applied at boot.
- **First run:** `features/onboard.js` opens itself when the global store key `onboarded` is unset (via the optional `boot(api)` feature hook). "Set up again" in the You sheet reopens it. Questions advance on tap (arrow keys only select); "Skip this question" sits under each; the web build leaves out the reminders step.
- **`api.swaps()`** returns the active swaps filtered by `facts` through `needs`. It never returns the lower-fare app or night rides. Use it instead of `data.swaps`.
- **`api.charges()`**: tags and night are resolved. `api.kindOf(charge|kind)` returns `food | move | night`. `api.kindLabel(k)`. `api.kindIcon(kind, { size, tile })` returns an SVG, or a labeled `.kind` well.
- **`api.store`** is per-profile automatically. Only `"profile"` is global. `store.getFor(profileId, key)`.
- **Motion:** `api.animate(el, keyframes, { preset: "snappy" | "standard" | "gentle", delay })`. It never throws and reads `api.reduced` live.
- **Sheets:**
  - `api.sheet(content, { label, title, detent: "large" | "medium", onClose, beforeClose, back })` returns `{ close, body, el, setBack }`. `"medium"` gives a floating inset glass sheet for short flows.
  - Sheets focus their title, trap focus behind with `inert`, close on Escape, and return focus to the opener.
  - `api.sheetActions(body, [Element | { label, kind, icon, onClick }])` pins actions at the bottom, safe-area aware. Call it again on each step, or pass `[]` to remove them.
  - `api.focusTitle(node)`: call after every step swap.
- **Other:**
  - `api.toast(text, icon)` uses one persistent live region.
  - `api.setSub(tab, text)` sets the line under a large title, e.g. "1 of 6".
  - `api.navAction(tab, el)` adds a glass button to that tab's nav bar.
  - `api.current()` returns the current tab.
  - `api.esc(s)` escapes HTML.
  - Icons: `person`, `people`, `bag`, `cup`, `tray`, `reset`, `share`, `plus`, `minus`, `chevronDown`, `back`, `close`, `lock`, `week`, `receipt`.

## Round 2 helpers (use these instead of your own logic)
- **Real vs sample:** `api.isReal(field)` (always true for live "You"), `api.allReal()`, `api.badge(field?)` returns the one small `Real`/`Sample` badge HTML, or `""` when the whole screen is real. Use it once per screen.
- **Dates:** `api.weekDays()` returns `[{ i, date: "2026-10-26", dow: "Mon", short: "Oct 26", label: "Mon, Oct 26", isToday }]` from the active profile's `weekStart` (never derive days from `today`). `api.weekLabel()` "Oct 26 – Nov 1". `api.weekName()` "This week" or "Last week" (live data shows the last full week). `api.weekIsPast()`. `api.weekKey()` (the week's start date: key a guess by it so a new week asks again). `api.todayLabel()` "Tuesday, Nov 3" (Chat date stamp).
- **Day of a charge:** `api.dayOf(charge)` returns 0..6; a ride from midnight to 6 AM counts toward the evening before. Use it for By day bars, day lists and receipts.
- **Cap:** `api.capOf(save?)`, `api.capParts(save?)` → `{ usual, save, owed, cap, max }`, `api.capLine(save?)` → "$661 usual − $100 save" (+ " − $10 owed" only when something is owed). First place a cap shows, add "Cap: usual minus savings." Never write "payback" for money you owe.
- **You sheet:** `api.openYou("save" | "remind" | "home" | "whose")` opens it scrolled to that section (e.g. the Week Cap row opens "save"; a Chat "change my save" or "reminders" answer opens it).
- **Living answers:** `api.questions` (one ordered list: kitchen, meal, subway, nights; `q`, `hint`, `opts`, `label`, `short`), `api.answers()`, `api.setAnswer(key, value)` (store `moveProfile`, now per profile and read by `api.facts()` for every profile). Move-in should use `api.questions` for the same order and wording.
- **Ride app:** `api.isRideApp(text)` is the only never-suggest check (lower-fare app). `api.rideAppAllowed()` is true only on the founder's private build. `api.displayMerchant(name)` shows the real name there (RIDE_APP_NAME); use it wherever a merchant name is drawn.
- **Logos:** `api.logo(name)` checks `SwapLive.logos` (private build), then the bundled App Store icons. `api.brandMark(name, kind, size, label?)` always returns an icon: the logo (22% corner, hairline), else a letter tile tinted by category, else the category glyph when there is no name. Decorative by default; pass `label` when no visible name sits next to it.
- **Other:** `api.radios(group, onPick)` (roving-tabindex radio group), `api.toast(text, icon, { action: { label: "Undo", onClick } })` (stays 4s, tappable), `api.sheetBack(body, fn)`. Reminders (`api.notify`) are one phone-wide setting now, not per profile.

## Profile data (data.js)
- **"you" with private/live.js (founder's phone):** everything is real (`live: true`), the week is the last full week, no owed amount (cap = usual − save), `rideAppName`, `recommendRideApp` (adds the "rideapp-rides" swap first), `syncedAt`, blurb "Your card, synced Nov 3, 12:47 AM".
- **No "you" without live data:** the public site has no "you" profile and opens on "social" (`?profile=` still picks). Base numbers the sync doesn't produce (move, DashPass, swaps) come from `private/founder.js` (gitignored; see `founder.example.js`). No real numbers in tracked files.
- **"mealplan" and "social":** all SAMPLE, with generic merchants. Their usual, this week, cap, subway taps and move averages are derived at load from the rows and charges, so they can't drift.
- **Formulas:**
  - usual = mean of the last 6 weekly rows (the last row is this week)
  - this week = sum of the charges
  - cap = usual − saveTarget − payback.perWeek (payback lowers the cap: 600 − 100 − 10 = 490)
- **Current values:**

  | Profile | Usual | This week | Cap | Note |
  |---|---|---|---|---|
  | mealplan | $240 | $213 | $215 | |
  | social | $467 | $460 | $427 | Over cap: handle it kindly, the payback absorbs it |

## Feature checklist
1. Replace content `.glass` with `.card`. Only floating controls stay glass.
2. Replace raw hex, radii and font sizes with tokens and classes.
3. Read `api.data` / `api.charges()` / `api.swaps()` / `api.facts()`. Never write "the founder" in sample profiles. Show the founder chart only when `api.profile() === "you"`.
4. Tailor to `facts`:
   - meal plan: swipe-based ideas, no guest-swipe swap
   - no subway, or 30+ min: no subway push
   - `moved: false`: no move story
5. Use sheet buttons through `sheetActions`, and call `focusTitle` after every step.
6. The feature works after a profile switch (return `dispose` if you add global listeners).
7. The `.ag-*` chat styles still assume an 18px gutter. Update them to 16.

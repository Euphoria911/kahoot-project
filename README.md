# kahoot-project

> **Educational use only.** This repository exists to demonstrate browser-automation and multimodal-LLM techniques — DOM introspection, event synthesis, React fiber traversal, vision-model prompting. Using it to cheat on real Kahoot quizzes violates [Kahoot's Terms of Service](https://trust.kahoot.com/terms-and-conditions/) and nearly every school academic-integrity policy. Spin it up against your own test lobbies and your own study sessions. Don't be a jerk.

A Tampermonkey userscript that reads the current Kahoot question from the DOM, asks Claude for the answer, and either highlights it with a glowing overlay or auto-clicks it. Covers all 13 Kahoot question types, including image questions, pin-to-image, and puzzle reorder.

![status: v8.7](https://img.shields.io/badge/version-8.7-orange) ![model: Claude](https://img.shields.io/badge/model-Claude-d97706) ![license: MIT](https://img.shields.io/badge/license-MIT-blue)

---

## Table of contents

- [Features](#features)
- [Install](#install)
- [Configuration](#configuration)
- [Panel UI](#panel-ui)
- [Hotkeys](#hotkeys)
- [Supported question types](#supported-question-types)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)
- [License](#license)

---

## Features

- **All 13 Kahoot question types.** Classic quiz, multi-select, true/false, type-answer, word cloud, open-ended, slider, pin answer, puzzle (reorder), scale, NPS, plus lobby and leaderboard auto-skip.
- **Vision support.** Any question with an image is sent to the vision model (`claude-sonnet-5-5` by default). Image answers inside puzzle questions get captured individually and attached as separate inputs so the model can match on tile content.
- **Pin answer.** The vision model receives the image and returns the correct point as `X% Y%`. The script paints a glowing crosshair at the exact spot and (if auto-click is on) dispatches a click there.
- **Puzzle reorder.** The model returns a permutation (e.g. `3 1 4 2`). Each tile gets an ordinal badge — 1st, 2nd, 3rd, 4th — that *follows the tile* across Kahoot's reshuffle animation using a text + image-src signature match. Tracked by a 400ms re-position loop so the badges never drift.
- **Multi-select.** Picks every correct digit, rings each tile, and (with auto-click on) hits the submit button after a short delay.
- **Three-tier auto-click.** When auto-click is on the script does *not* rely on a single `.click()`. It walks the React fiber up to five parents looking for an `onClick` prop and invokes it directly with a fabricated synthetic event (`isTrusted: true`) — bypasses most anti-cheat gating. Falls back to a full pointer + touch + mouse event chain targeting `elementFromPoint(cx, cy)` — then to native `.click()` as last resort.
- **Stealth mode.** `Alt+S` kills every overlay (ring, crosshair, ordinal badge, text hint) while auto-click keeps firing. Badge shrinks to a discreet 🥷 in indigo. State persists across reloads via `GM_setValue`.
- **Model override.** Pick any Claude model from the panel — Haiku for cheap text questions, Sonnet or Opus for vision or harder questions. Defaults are `claude-haiku-5-5` and `claude-sonnet-5-5`.
- **Key persistence.** API key stored in Tampermonkey's `GM_setValue`. Survives reboot and browser restart; only sent to `api.anthropic.com`.
- **Layout-independent hotkeys.** `e.code` + capture-phase listener. AZERTY, Dvorak, German, Cyrillic layouts all work.
- **Panel-based debug.** Live view of the detected question, kind, answer buttons, and raw model response — makes it obvious when a new DOM shape is breaking detection.

---

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension (Chrome, Firefox, Edge, or Brave — Safari works with Userscripts but is untested here).
2. Click the Tampermonkey icon → **Create a new script…**
3. Delete the template. Paste in the full contents of [`kahoot-winner-claude.user.js`](./kahoot-winner-claude.user.js).
4. Save with `Ctrl+S`. Tampermonkey registers the script with `@match https://kahoot.it/*`.
5. Open [kahoot.it](https://kahoot.it). A yellow 🎯 badge should appear in the top-right corner.
6. Click the badge → paste your Claude API key (`sk-ant-…`) → **save key**.
7. Join a game. The script detects questions as they arrive.

Get a Claude API key at [console.anthropic.com](https://console.anthropic.com/). The account needs API credits — the consumer Pro / Max subscription does **not** cover API usage, those are separate products.

---

## Configuration

Click the 🎯 badge to open the debug panel. Fields, top to bottom:

| Field | Default | Purpose |
|---|---|---|
| **Claude API key** | *(none)* | `sk-ant-…`. Stored in Tampermonkey's `GM_setValue`. |
| **Text model** | `claude-haiku-5-5` | Used when there is no image to read. Cheap and fast. |
| **Vision model** | `claude-sonnet-5-5` | Used whenever an image is present (image-questions, pin-answer, image-answers). |
| **Auto-click** | OFF | When ON the script fires `fireClick()` on the correct answer automatically. |
| **Stealth** | OFF | When ON no overlays are painted; auto-click still fires silently. |

All values persist across reloads. Hit **save key** or **save models** after editing a field.

---

## Panel UI

The panel displays live state so you can tell at a glance whether detection is working:

- **Q** — the detected question text (truncated to 160 chars). `[📷]` suffix means an image was attached.
- **K** — the detected kind: `quiz`, `multi`, `tf`, `type`, `wordcloud`, `openended`, `slider`, `pin`, `puzzle`, `scale`, `nps`, `lobby`, `leaderboard`, or `unknown`.
- **A** — detected answer buttons (with text) or shape of the input (e.g. `slider [0..100 step 1]`).
- **R** — raw Claude response (truncated to 220 chars) so you can see when a model is misbehaving.

Two action buttons:

- **scan DOM** — re-runs detection without calling the API. Useful for debugging a question that didn't trigger.
- **force now** — clears the "already answered this one" lock and re-runs the whole pipeline.

---

## Hotkeys

| Hotkey | Action |
|---|---|
| `Alt+H` | Hide / show the badge + panel (useful mid-game) |
| `Alt+A` | Toggle auto-click. Badge gains red `[AUTO]` suffix when ON. |
| `Alt+S` | Toggle stealth. Badge shrinks to 🥷 in indigo when ON. |

All three use capture-phase listeners and `e.code` (not `e.key`), so React can't swallow them and the keyboard layout doesn't matter.

---

## Supported question types

| Kind | Detection signal | How it's answered |
|---|---|---|
| `quiz` | 2–6 answer buttons, not multi-select | Model returns a digit `0..n-1`; ring + optional click |
| `multi` | `submit-answer-button` present or `multi-select-*` dfs attribute | Model returns space-separated digits; rings each; auto-submits if auto-click on |
| `tf` | Exactly 2 answer buttons | Treated as quiz with n=2 |
| `type` | Text input in the question area | Model returns a short answer string; input gets filled |
| `wordcloud` | Text input with `maxlength ≤ 25` | Same as `type` but output capped at 20 chars |
| `openended` | `<textarea>` present | Same as `type` with 200-char cap |
| `slider` | `input[type="range"]` or `role="slider"` | Reads `min` / `max` / `step`; model picks a number; slider value set |
| `pin` | `data-functional-selector*="pin-answer"` or `class*="PinAnswer"` | Vision model returns `X% Y%` on the image; crosshair overlay + optional click |
| `puzzle` | `data-functional-selector*="puzzle"` or `draggable="true"` | Model returns a permutation; ordinal badges painted and glued to tiles |
| `scale` | `data-functional-selector^="scale-"` | Routed through the slider handler |
| `nps` | ≥10 numeric buttons `0..10` | Model picks a digit in range; matching button gets rung |
| `lobby` | `game-pin-input` / `username-input` present | Skipped — no API call |
| `leaderboard` | `feedback-text` / `podium-*` present | Skipped — no API call |

---

## How it works

**Watchers.** A `MutationObserver` on `document.documentElement` fires `tryAnswer()` on DOM changes (debounced 180ms), plus a 900ms polling interval as backup. A separate 400ms interval keeps puzzle overlays glued to re-rendering tiles.

**Kind detection.** `detectKind()` runs lobby and leaderboard checks first (early exit — no API call), then pin and puzzle (DOM markers), then NPS (counts numeric buttons), scale, slider, text-input family, and finally the classic button-grid shape.

**DOM extraction.** The question is pulled from `data-functional-selector="question-title"` → class-name match (`QuestionTitle`, `QuestionText`, etc.) → geometric fallback (the text element nearest vertical center). Answers come from `data-functional-selector^="answer-"` → geometric fallback (large buttons in the bottom half of the viewport, sorted top-to-bottom-left-to-right).

**Image capture.** Any image inside `block-image` / `question-image` / `pin-answer-image` (or the largest visible image if none of those match) is drawn to an off-screen canvas at ≤1568px wide, encoded as JPEG at quality 0.9, and sent as a Claude image content block. Images on tainted canvases silently fall back to a text-only prompt.

**Prompting.** Each kind has its own prompt shape. Examples:

- Quiz: *"Kahoot quiz question (4 options, 0,1,2,3). Think carefully. Reply with ONLY ONE digit. NOTHING ELSE."*
- Pin: *"The player taps a point. Reply with the correct point as 'X% Y%' where X is horizontal (0-100, left=0) and Y is vertical (0-100, top=0)."*
- Puzzle: *"Example for 4 items: '3 1 4 2' means tile #3 goes FIRST, #1 goes SECOND, #4 THIRD, #2 LAST."*

**Response parsing.** Tolerant parsers that scan the response for the shape they want: `parseDigits` reads lines bottom-up looking for in-range digit characters; `parseNumber` grabs the first number; `parsePercent` wants two numbers; `parsePermutation` wants n distinct 1..n integers.

**Click execution** (only when auto-click is on):

1. **React fiber.** Walks up to 5 ancestors looking for a `__reactProps$*` key with an `onClick` function on it. Calls that function directly with a fabricated synthetic event (`isTrusted: true`, bubbling, with a native `MouseEvent`). This bypasses event-dispatch gating entirely because no DOM event is ever fired.
2. **Event chain.** Full `pointerover` → `pointerenter` → `mouseover` → `pointerdown` → `mousedown` → `touchstart` → `touchend` → `pointerup` → `mouseup` → `click` sequence against whatever is actually under the click point (`document.elementFromPoint(cx, cy)`), not against the resolved selector element — more faithful to how a real browser click resolves.
3. **Native `.click()`.** Last resort, usually swallowed by anti-cheat but harmless to try.

---

## Troubleshooting

**The badge appears but nothing happens on a question.** Open DevTools (`Ctrl+Shift+I`) → Console. Look for `[kw]` log lines. Click the badge → **scan DOM** to see which selectors matched. If `K: unknown`, Kahoot has shipped a new DOM shape and the detector needs an update — file an issue with a screenshot of the panel.

**"⚠ no key" on the badge.** Open the panel, paste your `sk-ant-…` key, click **save key**, then **force now**.

**401 Unauthorized / 403 in the R row.** The API key is wrong, revoked, or the Anthropic account has no credits. Check [console.anthropic.com](https://console.anthropic.com/). Remember: consumer Claude.ai subscriptions do NOT cover API usage.

**Rings the right answer but doesn't actually click.** Kahoot is enforcing `isTrusted` on this build and the React fiber path isn't finding `onClick`. Open console, look for `[kw] fiber onClick fired` vs `[kw] event chain fired` — if neither logs, the fiber traversal needs to walk deeper. File an issue.

**Puzzle: badges follow the right tiles, but auto-click moves nothing.** Correct — Kahoot's puzzle UI is drag-and-drop, not click-to-select. The current script highlights the right order; the actual drag is still manual. A drag-simulator is a separate feature on the TODO list.

**Answers wrong on half the questions.** Try switching the text model to `claude-sonnet-5-5` (slower, more capable). For image questions make sure the vision model is set to a vision-capable Claude model. Haiku is cheap but misses nuance on literature, history, or multi-step reasoning questions.

**Overlays appear way off from the buttons.** Scroll zoom or browser DPI scaling can throw off `getBoundingClientRect()`. Reset zoom to 100% (`Ctrl+0`) and reload.

---

## Privacy

- Your Claude API key is stored by **Tampermonkey** (`GM_setValue`) in your browser only. It is not synced to any cloud and never leaves your machine except inside request headers to `api.anthropic.com`.
- The script only connects to one network endpoint — `api.anthropic.com`. No telemetry, no analytics, no third-party endpoints. The `@connect` manifest in the userscript header enforces this at the Tampermonkey layer, so even if someone tried to add another endpoint to the script, Tampermonkey would block the request until you approve it.
- Every question text and image you encounter *is* sent to Anthropic as part of the Claude API call. If you don't want that, don't use the script.

---

## License

MIT, with an educational-use preamble. See [LICENSE](./LICENSE).

If you use this to cheat on an actual test, that's on you — don't blame the code.

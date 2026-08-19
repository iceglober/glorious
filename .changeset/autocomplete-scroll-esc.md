---
"@glrs-dev/glrs": minor
---

The completion list scrolls with the selection, and Esc dismisses it without interrupting.

**The list was cut to six before the composer ever saw it.** `matchNames`
sliced to six matches, and the composer draws a scrolling window over whatever
it is given — so with 37 commands the other 31 did not exist. Scrolling could
not reach them, and the `↓ n more` line, which counts what the window is not
showing, had nothing to count. Ranking now says what is likeliest and the
composer decides how much fits.

**The window is bounded by the terminal, not by a constant.** It was a flat ten
rows and never asked how tall the terminal was, so on a short one the last rows
were clipped and moving the selection into them looked like a list refusing to
scroll.

**Esc closes the menu and leaves what you typed alone**, without interrupting
the turn — you were dismissing a menu, not abandoning the line or stopping the
model. The dismissal is remembered against the text it happened on, so the menu
stays shut while you look at it and reopens as soon as you type again; a second
Esc reaches the interrupt as before.

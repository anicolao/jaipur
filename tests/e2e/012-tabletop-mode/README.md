# Shared tabletop mode

A neutral tabletop keeps public play on the shared screen while each QR-joined phone shows only its trader’s private hand and return selections.

## A pending draw keeps every market and token position stable

![A pending draw keeps every market and token position stable](./screenshots/000-pending-draw-desktop.png)

**Verifications:**

- [x] The selected market slot remains face down until the active trader confirms or undoes the draw
- [x] Both seat-oriented token views show the same shared inventory

## Two opposite player edges share one market and mirrored token supplies

![Two opposite player edges share one market and mirrored token supplies](./screenshots/001-two-seated-table-desktop.png)

**Verifications:**

- [x] The top player UI and its upper-left log are rotated exactly 180 degrees
- [x] The lower player UI and lower-right log remain upright
- [x] Each player has a correctly oriented view of one synchronized token inventory
- [x] Market cards face the active player by default and rotate only after the prior action settles
- [x] All five card and return-target coordinates remain permanent as slot contents change
- [x] Private phone selections load face-down table targets and keep exact token values private
- [x] Public actions use direct card flights instead of a text notification overlay
- [x] The complete tabletop fits without document scrolling

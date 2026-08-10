# Shared tabletop mode

A neutral tabletop keeps public play on the shared screen while each QR-joined phone shows only its trader’s private hand and return selections.

## A pending draw keeps every market and token position stable

![A pending draw keeps every market and token position stable](./screenshots/000-pending-draw-desktop.png)

**Verifications:**

- [x] The selected market slot remains face down until the active trader confirms or undoes the draw
- [x] The confirmation prompt appears upright beside the receiving player’s edge
- [x] Both seat-oriented token views show the same shared inventory

## Two opposite player edges share one market and mirrored token supplies

![Two opposite player edges share one market and mirrored token supplies](./screenshots/001-two-seated-table-desktop.png)

**Verifications:**

- [x] The top player UI and its upper-left log are rotated exactly 180 degrees
- [x] The lower player UI and lower-right log remain upright
- [x] The synchronized token views occupy opposite full-height rails and face their respective players
- [x] Either token view can complete the active player’s sale
- [x] Market cards and return targets face the active player after the prior action settles
- [x] Deck counts flank the physical pile and remain naturally readable from both seats
- [x] All five card and return-target coordinates remain permanent as slot contents change
- [x] Private phone selections load face-down table targets and keep exact token values private
- [x] Public actions use direct card flights instead of a text notification overlay
- [x] The complete tabletop fits without document scrolling

# Tabletop UI fixes proposal

## Goal

Make tabletop mode feel like a shared physical Jaipur table with two private
hand controllers, rather than a desktop application divided into three
panels. A player should be able to glance at the table, understand whose turn
it is, see the available physical actions, and complete a move without reading
instructions or mentally translating between the phone and table.

This proposal is based on the current recorded views:

- [active tabletop](./tests/e2e/012-tabletop-mode/screenshots/000-two-seated-table-desktop.png)
- [ordinary desktop market](./tests/e2e/003-round-setup-and-private-hands/screenshots/000-market-open-desktop.png)
- [ordinary desktop exchange](./tests/e2e/011-responsive-accessible-complete-game/screenshots/000-keyboard-exchange-desktop.png)
- [round summary](./tests/e2e/008-round-end-and-scoring/screenshots/000-round-scored-desktop.png)

The current tabletop already has several important properties that should not
be lost:

- private goods remain on each player's phone;
- the public table shows face-down hand counts, herds, seals, and token counts;
- market cards occupy stable slots during exchanges and refills;
- cards and tokens animate between their real sources and destinations;
- the top player's edge and log are rotated 180 degrees;
- token values remain private after they are earned;
- the complete table fits without document scrolling.

## What the screenshots reveal

### The shared table is visually secondary

The two player panels consume more than half of the display height. The public
market is compressed into the middle, while the token bank consumes a full
vertical rail on one side. This gives the screen the hierarchy of a dashboard:
player information first, market second. On a real table the market, deck, and
token bank are the primary objects, with compact player areas at the edges.

### Pieces change size as they move

Market cards and the deck are substantially larger than the face-down cards
in each player's public hand. A drawn card therefore stops behaving like one
physical object and appears to shrink into a UI representation. Exchange
returns shrink even further inside the dashed targets. Seven cards can fit at
one physical size by overlapping or fanning; they should not be scaled down.

### Reach and orientation favor the bottom player

The token rail is beside the bottom player's right hand, but some stacks are a
long reach from the top player. Its labels also have one reading direction.
The market is shared and centered, while one of the other two principal action
surfaces is not. This makes selling feel like using a toolbar rather than
moving cards to a common token bank.

### The next action is explained in small prose

The most important guidance appears as a small sentence at the bottom of a
large player panel. The table asks the player to infer a mode from invisible
phone state: select privately, find a dashed target or token pile, then
possibly find a confirmation control elsewhere. The phone reports counts, but
neither surface presents the whole interaction as a short, spatial sequence.

### Turn and action feedback are too quiet

The active edge gains a gold border and a small `Your turn` pill. The most
recent action is available only after opening a corner log. From across a
physical table, neither is strong enough to answer the two common questions:
“Is it my turn?” and “What did the other player just do?”

### Utility information competes with play

The tabletop ID, connection text, build hash, round label, deck count, and
logs all occupy the play surface. In the screenshot, connection/build text
sits directly against the lower player edge. This information is useful, but
it should not compete with cards or suggest that it is an action.

### The table cannot be resumed explicitly

`/tt/` always creates a new random room, even if `gameId` is supplied. A page
reload therefore produces another table and another pair of QR codes rather
than reconnecting the physical display. Recovery is part of a natural
tabletop experience and should be unambiguous.

## Proposed table layout

Use the entire width as a table and make both player edges shallow. Move the
token bank into the shared center so both players have similar reach.

```text
┌──────────────────────────────────────────────────────────────────────┐
│  P1 log       P1 hand fan   P1 herd   P1 token backs    P1 status   │
│                        (rotated 180°)                                │
├──────────────────────────────────────────────────────────────────────┤
│                     P1 action / latest-action dock                   │
│                                                                      │
│  bonus piles   deck    [ market slot 1 ··· market slot 5 ]          │
│                                                                      │
│          diamond   gold   silver   cloth   spice   leather           │
│                     shared horizontal token bank                     │
│                                                                      │
│                     P2 action / latest-action dock                   │
├──────────────────────────────────────────────────────────────────────┤
│  P2 status     P2 hand fan   P2 herd   P2 token backs       P2 log  │
└──────────────────────────────────────────────────────────────────────┘
```

The market, deck, exchange returns, public hand cards, and herd cards should
all use one `--table-card-size`. Hand cards overlap as necessary. Token stacks
retain one chip size from the bank through their flight to a player's tray.

The goods bank should be a horizontal, six-stack physical bank in the shared
zone. Bonus piles sit by the deck. Goods art and rim values already identify
the stacks, so labels can be duplicated on both edges of the bank or made
orientation-neutral. Nothing in the bank should be greyed out based on either
player's private hand.

Player edges should contain only public physical state and immediate status:

- oriented player name and a large turn beacon;
- a fan of full-size face-down cards;
- the messy public camel herd;
- a stack of neutral token backs plus the public token count;
- seals;
- the latest action and access to that player's oriented log.

Remove the large empty areas and pill-shaped `N tokens` boxes. Earned tokens
should visibly accumulate as a face-down chip pile; the exact values remain on
the private phone.

## Interaction model

### A persistent active-player dock

Place one compact action dock at the inner edge nearest the active player. It
rotates with that player and changes with the current action. The inactive
edge shows the latest completed action in the same location.

The dock has three states:

1. **Choose** — a short instruction such as `Choose a market card, camels, or
   private cards on your phone`.
2. **Stage** — a concrete summary of the pending physical move and its next
   valid destinations.
3. **Confirm** — prominent confirm and cancel controls when the move can reveal
   information or when an exchange has been completely loaded.

Touch targets should be at least 56 by 56 CSS pixels on the tabletop. Controls
must never be placed under a player's arm at the far side of the display.

### Draw one good

1. The active player taps a market good.
2. That exact market slot immediately turns face-down and reads `Draw Single`.
3. The active-player dock says `Draw the Spice?` with `Confirm` and `Cancel`.
4. Confirm flies the selected card directly into the active hand, then flies a
   full-size card from the deck to the same market hole, flips it, and settles
   it into place.
5. Cancel restores the original card in the same slot without moving any
   other market card.

The existing persisted pending-draw event remains the source of truth so the
phone and every connected display observe the stage immediately.

### Draw camels

Treat the camels as one physical group action:

1. Tapping any camel turns every camel slot face-down and labels the staged
   cards `Draw Camels`.
2. The dock says `Take all N camels?` and shows confirm/cancel.
3. On confirm, the camels fly as a short staggered group to the active herd.
4. Deck cards refill the vacated slots individually without reordering the
   remaining market.

### Exchange

The phone and table should read as one numbered sequence:

1. `Select cards or camels to return` on the phone.
2. `Place them below the goods you want` on the table.
3. `Confirm trade` in the active-player dock.

When the phone has selected at least one return, the table should animate a
brief pulse around every empty exchange destination. Each destination should
be a card-size dashed silhouette aligned with its market slot. Tapping it
flies the next selected card directly from the player's public hand or herd
into the silhouette. The returned card stays full-size and face-down.

A loaded destination can be tapped to send that return card back to the hand
or herd and restore the phone selection. Existing market cards must never
reflow. Once at least two legal pairs are loaded, the dock shows a physical
summary (`Trade 2 for Diamond + Gold`) and confirm/cancel. Cancel unloads all
returns; confirm runs the existing exchange and flip animations.

Use ordinal markers on both devices while staging (`1`, `2`, `3`) so the user
can see which private selection will fill the next public target without
revealing its face.

### Sell goods

Keep both supported paths, but make their result predictable:

- selecting same-kind goods makes the phone name and illustrate the matching
  public token stack while the table bank itself remains visually unchanged;
- tapping that stack sells the selected cards;
- tapping a stack with no private selection sells all held cards of that kind,
  as it does now;
- mixed selections do not grey or alter unrelated stacks, because that would
  disclose private information to the opponent.

Before the tap, the active-player dock should say either `Tap the matching
token stack to sell selected goods` or the neutral `Tap a token stack to sell
all matching goods`. The committed sale then flies full-size face-down cards
from the public hand to the bank and chips from their real stacks to the
player's face-down token pile. Bonus chips use their own pile as the source.

### Latest action and history

Always display the latest completed action in both orientations, close to each
player edge. Examples:

- `Asha took all 3 camels`
- `Belen traded 2 cards for Diamond + Gold`
- `Asha sold 4 Spice and earned 5 tokens`

The two existing corner logs remain, but become secondary history. Opening a
log must not cover the market or confirmation controls. Animations and the
latest-action text should be driven by the same `GameActivity`, so they cannot
describe different actions.

## Private phone controller

The phone should remain a private hand, not a miniature game board. Improve it
as the first half of a two-device interaction:

- make `Your turn` the dominant header state and dim selection controls while
  waiting;
- keep all cards at a stable square size and overlap/fan only when space is
  constrained;
- group goods by kind without changing their stable identity;
- show a numbered selection tray above the hand rather than only `N selected`;
- label loaded cards with their destination number and `On table`;
- show the exact herd count and individual selectable camel cards;
- after a selection, replace generic instructions with one explicit next step:
  `Now tap a dashed market slot` or `Now tap the Spice token stack`;
- mirror pending draw, exchange, and round-complete states from the persisted
  log immediately;
- keep exact earned token values and score exclusively in this private view
  during the round.

The phone should never require scrolling to reach the cards needed for the
current action on common portrait sizes. If seven goods plus the herd cannot
fit at full size, use controlled overlap before introducing scroll.

## Turn, orientation, and shared information

Make the active player unmistakable from either seat:

- illuminate the whole active edge with a warm, restrained table-light effect;
- point a central turn marker toward the active edge;
- use `Your turn` on the active-oriented edge and `{name}'s turn` on the other;
- give staged actions a distinct amber state and syncing/errors a distinct red
  state; do not reuse these colors for ordinary decoration.

The shared display may show:

- player names, turn, hand counts, physical herd, seals, and token counts;
- market, deck count, supplies, staged public destinations, and completed
  actions;
- number of face-down exchange returns once the player deliberately places
  them on the table.

It must not show:

- private card faces or kinds before they enter the market;
- exact values of owned tokens during the round;
- disabled/grey token piles based on cards in either private hand;
- bonus-token values before or after they are privately awarded.

## Joining and recovery

Define the routes explicitly:

- `/tt/` creates a new random tabletop game.
- `/tt/?gameId=ABCDE` attaches the display to an existing **tabletop** game.
- `/hand/?gameId=ABCDE&seat=1` and `seat=2` remain the private controllers.

If a supplied game exists but is standard or bot mode, show a clear message
instead of creating a new room or trying to convert it. If it does not exist,
offer `Create this tabletop` rather than silently choosing another code.

On reconnect, the table should replay directly into its current state. Show QR
codes only for empty seats, and preserve the existing game code prominently
during setup. Once play begins, move the code, connection state, and build hash
into a small `Table info` popover opened from neutral side controls. A red
offline indicator may remain visible because it requires action; normal synced
status should not occupy the play surface.

## Round and game summaries

Continue using the shared `GameSummary` data and score breakdown, but provide a
tabletop presentation that is legible from both seats:

- render the same detailed result in two mirrored orientations;
- show every collected goods token, bonus token, camel award, total, seals,
  and any tiebreak explanation;
- keep one shared data model so ordinary, tabletop, and private views cannot
  disagree;
- place `Open next round` or `Rematch` controls near both player edges, with a
  single idempotent action underneath;
- preserve the no-scroll constraint at the target tabletop resolutions.

## Visual language

Favor physical state over application chrome:

- cards, chips, piles, slots, and table felt carry the hierarchy;
- borders define real placement zones, not large rectangular panels;
- a dashed outline always means `a physical piece can be placed here`;
- gold means active or ready to commit, never merely decorative;
- face-down pieces retain the same dimensions as their face-up versions;
- disabled controls remain visually present unless hiding them cannot reveal
  private state;
- instructional prose is replaced by short verbs adjacent to the next touch.

## Proposed implementation sequence

1. **Reconnectable tabletop shell**
   - separate new-table and attach-table initialization;
   - add `/tt/?gameId=` recovery and explicit incompatible-room errors;
   - add setup, reconnecting, active, offline, and fatal-error visual states.
2. **Physical table geometry**
   - remove the right rail and large player panels;
   - introduce one card-size variable and overlapping edge hands;
   - build the shared horizontal goods bank and bonus/deck cluster.
3. **Oriented action docks**
   - centralize choose, staged draw, staged exchange, confirm, and cancel UI;
   - strengthen active-player and pending-action states.
4. **Exchange and sale choreography**
   - make exchange silhouettes card-size;
   - add numbered phone selections and matching table placements;
   - add neutral sale guidance without leaking hand contents.
5. **Feedback and summaries**
   - add mirrored latest-action strips;
   - refine logs, token-back trays, animations, and dual-orientation summaries;
   - move ordinary diagnostics into `Table info`.
6. **Regression coverage**
   - add state-specific visual fixtures, geometry assertions, privacy checks,
     recovery coverage, and reduced-motion behavior.

Each step should be independently reviewable and should preserve a playable
table rather than landing a partially converted layout.

## Acceptance criteria

### Geometry and responsiveness

- Market, deck, public hand, herd, exchange-return, and animated cards have the
  same bounding-box dimensions.
- Five market slots retain their positions through draws and exchanges.
- Seven-card hands fit through overlap without shrinking individual cards.
- Every primary tabletop target is at least 56 by 56 CSS pixels.
- Both 16:9 landscape and the existing 1280 by 1000 tabletop fixture fit with
  no horizontal or vertical document scrolling.
- Token stacks are within comparable reach of both seated players.

### Interaction

- A first-time player can complete draw-one, draw-camels, exchange, and sale by
  following only the current phone/table prompts.
- The active player and current staged action are identifiable from either
  side at a glance.
- Draw confirmation does not reveal a replacement card before commit.
- Cancelling a staged draw or exchange restores the exact previous slots and
  selections.
- Every committed action produces a source-to-destination animation and an
  immediately visible latest-action description.

### Privacy

- The table never renders private hand faces or exact owned-token values.
- Token-stack appearance does not reveal whether a player can sell a kind.
- Table-visible selection state contains no private card kind before a
  committed exchange or sale reveals it by rule.

### Recovery and accessibility

- Reloading `/tt/?gameId=ABCDE` reconnects to the same tabletop game without
  appending a second creation event.
- QR links return to the same seats after a phone reconnect.
- All actions remain keyboard accessible and have meaningful accessible names.
- Reduced-motion mode settles pieces directly into the same final slots.
- Offline and fatal states are distinguishable without using color alone.

## Review decisions

The recommended default is one centered horizontal token bank. The main
alternative is two mirrored visual banks backed by the same logical supplies;
that improves orientation but makes the physical inventory look duplicated.

The recommended sale behavior is to retain the existing deliberate one-tap
sale after clear guidance. Adding a cancellable sale preview would reduce
mistakes but would also publicly expose a proposed private sale before it is
committed.

The recommended summary is a dual-orientation presentation of one shared
component model, rather than rotating the entire result toward whichever
player won.

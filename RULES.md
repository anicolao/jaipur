# Jaipur rules summary

This is an implementation-oriented summary of the current Space Cowboys
edition, not a replacement for the published rulebook. Stable IDs, exact token
inventories, visibility rules, and edge cases are included so the browser game
can be deterministic.

## Goal

Jaipur is a trading game for exactly two players. During each round, players
collect goods from a shared market, exchange cards and camels, and sell sets for
rupees. The richer player at the end of a round earns one Seal of Excellence.
The first player to earn two seals wins the game.

## Components

The deck contains 55 cards:

| Card type | Count |
| --- | ---: |
| Diamonds | 6 |
| Gold | 6 |
| Silver | 6 |
| Cloth | 8 |
| Spice | 8 |
| Leather | 10 |
| Camels | 11 |

Diamonds, gold, and silver are the three expensive goods. Cloth, spice, and
leather are the common goods.

There are 38 goods tokens. Each goods pile is arranged in the following order,
with the leftmost/highest value awarded first:

| Goods | Token values |
| --- | --- |
| Diamonds | 7, 7, 5, 5, 5 |
| Gold | 6, 6, 5, 5, 5 |
| Silver | 5, 5, 5, 5, 5 |
| Cloth | 5, 3, 3, 2, 2, 1, 1 |
| Spice | 5, 3, 3, 2, 2, 1, 1 |
| Leather | 4, 3, 2, 1, 1, 1, 1, 1, 1 |

There are 18 shuffled bonus tokens in three separate supplies:

| Sale size | Token values |
| --- | ---: | --- |
| 3 cards | 1, 1, 2, 2, 2, 3, 3 |
| 4 cards | 4, 4, 5, 5, 6, 6 |
| 5 or more cards | 8, 8, 9, 10, 10 |

The exact value of a bonus token is hidden until it is drawn. There is also one
camel token worth 5 rupees and three Seals of Excellence.

The implementation must keep an exact, versioned component manifest. It must not
represent identical cards or tokens as interchangeable counters internally:
every card and token needs a stable instance ID so replay can prove that
nothing was duplicated or lost.

## Round setup

1. Put three camel cards face up in the market.
2. Shuffle the other 52 cards.
3. Deal five cards to each player.
4. Put the remaining cards face down as the deck.
5. Draw two cards from the deck to bring the market to five cards. Either or
   both drawn cards may also be camels.
6. Each player moves every camel from their initial hand into their herd.
7. Reset each goods-token pile in descending value order.
8. Shuffle the 3-card, 4-card, and 5+-card bonus supplies independently.
9. Choose the starting player. In later rounds, the player who lost the
   previous round starts.

Camels in a herd are not part of a player's hand and do not count toward the
seven-card hand limit. The physical rules do not require a player to disclose
their camel count. The trustworthy browser UI should therefore show the owner
their exact herd and show the opponent only that a herd exists, even though
previous public actions and the shared event stream may make the count
inferable.

## A turn

On a turn, the active player must do exactly one of the following:

- take cards from the market; or
- sell cards from their hand.

A player cannot take and sell on the same turn and cannot voluntarily pass.
After the action and any required market refill, check whether the round ends.
If it does not, the other player takes the next turn.

## Taking cards

Taking cards has exactly three forms.

### Take one good

Take one non-camel goods card from the market into your hand. Draw the top card
of the deck into the vacant market position.

This action is legal only if the resulting hand has at most seven cards.

### Take all camels

Take every camel currently in the market and add them to your herd. Draw the
same number of cards from the deck to refill the market as far as possible.

You may not take only some of the camels. Camels enter the herd directly, so
this action is not limited by hand size.

### Exchange two or more goods

Choose at least two goods cards from the market. They may be of different goods
types. Put exactly the same number of cards into the market from:

- goods in your hand;
- camels in your herd; or
- a mixture of the two.

The exchange is simultaneous and does not draw from the deck. It is subject to
all of these restrictions:

- Only goods may be taken; an exchange cannot take camels.
- At least two cards must be taken and returned. A one-for-one exchange is not
  allowed.
- No goods type may appear on both sides of the exchange. For example, a player
  cannot take cloth while returning any cloth.
- The resulting hand may contain no more than seven cards.
- Every returned camel leaves the herd; every taken card enters the hand.

## Selling cards

Choose exactly one goods type and discard any legal number of cards of that type
from your hand. A turn can never sell multiple goods types.

- Leather, spice, and cloth may be sold one or more at a time.
- Silver, gold, and diamonds must be sold at least two at a time.

Resolve the sale in this order:

1. Discard all cards in the sale.
2. For each sold card, take the next highest-value token from that goods pile
   while tokens remain.
3. If at least three cards were sold, take one token from the corresponding
   bonus supply: 3, 4, or 5+.

If fewer goods tokens remain than cards sold, the player takes all remaining
goods tokens and still receives the bonus appropriate to the number of cards
sold. The expensive-goods two-card minimum still applies when only one or zero
matching goods tokens remain. If the matching bonus supply is empty, no bonus
token can be taken.

Goods-token values and the number of tokens a player has collected are public.
The value of a drawn bonus token is visible to its owner and hidden from the
opponent until scoring. Cards remaining in either hand are private.

## End of a round

A round ends immediately after the active player's action when either:

- three of the six goods-token piles are empty; or
- the deck does not contain enough cards to refill the market to five.

The action still completes. If a refill can place only some required cards,
place those cards and then end the round.

The player with more camels receives the camel token, worth 5 rupees. If the
herds are tied, neither player receives it.

Each player totals:

- the values of their collected goods tokens;
- the values of their bonus tokens; and
- the camel token, if they received it.

The player with the greater total earns one Seal of Excellence. If the totals
are tied, compare:

1. number of bonus tokens collected; then
2. number of goods tokens collected.

The published rulebook gives no further tie-break after equal goods-token
counts. Before the scoring slice is implemented, the project must record and
test a single explicit residual-tie policy rather than silently selecting a
winner. Until that decision is documented, such a replay must stop at a visible
`unresolved-round-tie` state.

If neither player has two seals, reset every round component and play again.
The loser of the previous round starts the new round.

## End of the game

As soon as a player earns their second Seal of Excellence, the game ends and
that player wins. At most three rounds are required.

## Digital visibility

The normal client should present information according to the physical game:

| Information | Owner | Opponent |
| --- | --- | --- |
| Hand cards | Exact cards | Card count |
| Herd | Exact camel count | Herd without exact count |
| Goods tokens | Types, values, and counts | Types, values, and counts |
| Bonus tokens during round | Count and owned values | Count only |
| Deck | Remaining count | Remaining count |
| Market and supplies | Full | Full |
| Scores after round | Full | Full |

This is a presentation boundary, not a security boundary. The proposed
trusted-client protocol stores enough information for deterministic replay in a
stream readable by both players.

## Source

Space Cowboys:
[Jaipur product page](https://www.spacecowboys-games.com/game/jaipur/) and
[English rulebook](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/11/Rules-JAIPUR-12x17-Version-EN_BD.pdf).

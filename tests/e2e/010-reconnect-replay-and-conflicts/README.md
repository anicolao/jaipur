# Reconnect, replay, and conflicts

Belen replays a cached game after a browser-network interruption; concurrent, duplicate, and incompatible events remain visible but harmless.

## A trader with an interrupted browser network keeps a stable cached projection

![A trader with an interrupted browser network keeps a stable cached projection](./screenshots/000-offline-cache-desktop.png)

**Verifications:**

- [x] Belen remains on the cached turn while Asha continues the canonical game

## Reconnect and reload replay the same canonical state

![Reconnect and reload replay the same canonical state](./screenshots/001-replayed-after-reload-desktop.png)

**Verifications:**

- [x] Both clients converge without rejoining or losing private state

## Invalid concurrent and incompatible entries cannot corrupt replay

![Invalid concurrent and incompatible entries cannot corrupt replay](./screenshots/002-conflicts-contained-desktop.png)

**Verifications:**

- [x] The first canonical action applies and the stale concurrent action is ignored
- [x] An incompatible version produces a blocking accessible alert

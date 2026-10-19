# Refresh signed-in game market prices

The game exposes 349 current item prices at `https://play.capitalrift.com/api/market/ticker` while a player is signed in. The local planner stores these prices and enforces a 24-hour gap between imports. It does not store game cookies, Google credentials, or access tokens.

## Set up the bookmarklet

1. Start the local planner at `http://localhost:3000/`.
2. Create a browser bookmark named **Sync Capital Rift prices**.
3. Copy the complete single line from [`templates/capitalrift-market-sync-bookmarklet.txt`](../templates/capitalrift-market-sync-bookmarklet.txt) into the bookmark's URL field.
4. Open `https://play.capitalrift.com/` in the same browser and make sure you are signed in.
5. Click the bookmark. It reads the market ticker and sends only the returned price data to the local planner. It does not submit a trade or change game state.
6. Return to the planner's Prices view and reload it. It should show 346/346 catalogue items priced.

The bookmarklet avoids requesting the game ticker again for 24 hours in that browser. The local database independently enforces the same interval and records successful imports in `market_item_sync_log`. A successful sync creates 349 item quote rows and one history sample per ticker item.

If the browser blocks the local sync request, the quote request is not guaranteed to have reached the local database. Do not repeat the sync multiple times; check the Prices view and `market_item_sync_log` first. Automated unattended updates need an official service credential or supported server-side integration from the developers.

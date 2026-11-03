# Sync relay

The relay behind "Watch together" (`modules/sync.js`). One Durable Object per room. It keeps the
room's current anchor and passes it to the other members. Each player computes the rest itself from
Twitch's own clocks. The relay runs on Cloudflare's free plan.

## Run it locally

    npm install
    npm run dev          # ws://127.0.0.1:8787

To point the extension at it, set `chrome.storage.local` key `tw5SyncRelay` to that address.

## Put it online

    npx wrangler login   # opens the browser on your Cloudflare account
    npm run deploy       # prints https://tw5-sync.<your-subdomain>.workers.dev

Then set `RELAY_DEFAULT` in `modules/sync.js` to the printed address, with `wss://` in place of
`https://`. It is currently `wss://tw5-sync.tw5-sync-relay.workers.dev`.

The relay runs on the Workers Free plan and cannot be billed: past a free daily limit, Cloudflare
refuses requests until the next day. Only a subscription to Workers Paid, made in the dashboard,
would change that.

## Protocol

Clients connect to `/room/<CODE>`, where the code is six characters from `A-Z` (without `I` and
`O`) and `2-9`. The relay sends three kinds of message:

- `{t: "welcome", a, n}` on arrival: the room's anchor (or `null` for a new room) and the member count.
- `{t: "anchor", a, n}` when another member changes the anchor.
- `{t: "members", n}` when someone joins or leaves.

A client sends `{t: "anchor", a}`. The relay stores it and relays it to the other members. A room
forgets everything when its last member leaves.

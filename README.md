# Jasoos — Urdu Multiplayer Party Game

A mobile-first, right-to-left Urdu spy party game. Players join with a four-letter room code; no player account or app installation is required.

## Features implemented
- 3–8 players, host-created room, four-letter room code
- Urdu RTL interface and short how-to-play screen
- One random spy and private secret-word assignment
- Built-in word categories: Pakistani cities, foods, cricketers, everyday objects
- Clockwise one-word hint turns
- Secret votes, tie handling, final spy guess, scores across rounds
- Nicknames, online/offline indicator, sound effects, scoreboard
- Socket.IO real-time synchronization and player-session rejoin
- Basic health endpoint at `/health`

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000` in multiple browser windows/devices on the same network. To test from a phone on the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:3000`.

## Publish publicly (free-first)
This is a Node + Socket.IO application, so it must be deployed to a host that supports a persistent WebSocket server. Do **not** deploy it as static-only hosting.

1. Create a GitHub repository and upload the contents of this folder.
2. Create a Web Service on Render (or another Node host that supports WebSockets) and connect the repository.
3. Use build command `npm install` and start command `npm start`.
4. The host will provide a public HTTPS URL. Test `/health`, then open that URL on multiple phones and verify create/join, roles, hints, voting and scoring.
5. Check the hosting provider's current free-tier policy. Free instances may sleep, restart, or have limits.

## Important deployment limitations
- Room state is currently held in server memory. If the server restarts or redeploys, active rooms and scores are lost. Player reconnect works after temporary browser/network disconnects while the server process remains alive.
- The server does not yet have a database-backed persistent room store, automated timeout for disconnected players, moderation, or production abuse/rate-limit controls.
- Do not treat this starter as hardened for large public traffic. Before a wider public launch, add persistent storage, disconnect-turn recovery, rate limits, room expiry, and automated integration tests.
- Keep the Node server process running for real-time multiplayer. The `public/` directory is served by the same server.

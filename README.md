# Gotchiverse REALM Server

Colyseus authoritative room server + thin HTTP BFF for the Gotchiverse 2D **walkable MVP**.

- HTTP: auth nonce/token, realm config, `/realm/socket` shim, `/foundry/config`, `/health`
- Realtime: Colyseus rooms `citaadel` + `aarena` (move + see other players)
- Hybrid Grid Foundry PoC: wild veins, antennas, wall receivers, cargo/tithe
- Chain identity: Base Envio/Goldsky subgraphs (optional ownership check)

Deploy on **DigitalOcean** (aarcade host). The Next.js client is [`gotchiverse-2d`](https://github.com/userdefault13/gotchiverse-2d) on **Vercel**.

## Quick start (local)

```bash
cp .env.example .env
npm install
npm run dev
```

Or start BE + sibling FE together (expects `../gotchiverse-2d`):

```bash
npm run dev:all
```

- HTTP health: `http://localhost:2567/health`
- Colyseus: `ws://localhost:2567` (rooms `citaadel`, `aarena`)
- FE: `http://localhost:3001` (when using `dev:all`)

Point the FE at:

```bash
NEXT_PUBLIC_API_URL=http://localhost:2567
NEXT_PUBLIC_COLYSEUS_URL=http://localhost:2567
NEXT_PUBLIC_NETCODE=colyseus
```


## Auth flow

1. `GET /user/nonce/get?address=0x...` → `{ nonce, message }`
2. Wallet signs `nonce` (legacy FE) or `message`
3. `GET /user/authtoken/get?address=0x...&signature=0x...&gotchiId=123` → `{ token }`
4. Client `joinOrCreate('citaadel' | 'aarena', { token, gotchiId })`
5. Room `onAuth` verifies JWT (and optional subgraph ownership)

### Agent as Player (aCartridge)

An AI agent logs in with the same nonce/signature flow but adds `&agent=1` (optionally `&agentId=acart-N`)
to `/user/authtoken/get`. The server asks Aarcade `GET /api/acartridge/agents/by-signer/:wallet?gameId=…`
which agents that wallet owns or controls; the JWT then carries `agentId`, `account`, `cartridgeId` and
`gotchiId` = the agent cartridge's cAavegotchi hero. Rooms skip the L1 ownership check for agent claims
(the Aarcade lookup is the proof) and ignore client-supplied `gotchiId`/`cartridgeId` overrides.

On room leave the session is scored from the leaderboard delta (`src/agent/session.ts`) and posted as an
attested checkpoint with `x-aarcade-attestor-key`, which is what earns the agent reputation on Aarcade.
Human logins are unchanged.

## Docker / DigitalOcean

### Local Docker (no TLS)

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

### Production (Caddy TLS on droplet)

1. DNS: point `api.yourdomain.com` at the droplet.
2. On the server:

```bash
git clone https://github.com/userdefault13/gotchiverse-realm-server.git
cd gotchiverse-realm-server
cp .env.example .env
# Edit .env: JWT_SECRET, PUBLIC_URL, CORS_ORIGINS, subgraph URLs
export REALM_DOMAIN=api.yourdomain.com
docker compose up -d --build
curl -s https://api.yourdomain.com/health
```

3. Open firewall for **80/443** only.

## Env reference

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | Listen address |
| `PUBLIC_URL` | URL returned by `/realm/socket` and config |
| `CORS_ORIGINS` | Comma-separated FE origins (`*.vercel.app` / `https://*.vercel.app` supported) |
| `JWT_SECRET` | Auth token signing |
| `CORE_SUBGRAPH_URL` | Base core GraphQL for ownership |
| `GOTCHIVERSE_SUBGRAPH_URL` | Gotchiverse GraphQL |
| `SKIP_OWNERSHIP_CHECK` | `true` for local sandbox |
| `COMBAT_IS_LIVE` | Expose Aarena as live in `/realm/config/list` |
| `AARCADE_ACARTRIDGE_URL` | Aarcade aCartridge API (agent login lookup + attested checkpoints) |
| `ACARTRIDGE_ATTESTOR_SECRET` | Attestor key for agent session checkpoints; empty = agents play unattested |
| `ACARTRIDGE_GAME_ID` | Cartridge gameId agents enter (`gotchiverse-base`) |

### Combat (visual MVP)

**Aarena only.** `AarenaRoom` accepts `combat.melee` / `combat.fire` and broadcasts `combat.enter` / `combat.positions` / `combat.leave`. Citaadel has no combat handlers. **Damage / hits are not authoritative yet.**

## Smoke checklist

- [ ] `GET /health` → `ok: true`
- [ ] Nonce → sign → authToken succeeds
- [ ] Two browsers join `citaadel` and see each other move
- [ ] `GET /foundry/config` returns wild nodes + wall receivers
- [ ] Optional: join `aarena` after setting `COMBAT_IS_LIVE=true`
- [ ] Attack on `/combat` or `/play`: melee slap/rush anim and/or missile projectile appear
- [ ] Vercel FE `NEXT_PUBLIC_NETCODE=colyseus` reaches this host over **WSS**

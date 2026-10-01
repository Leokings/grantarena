# GrantArena

GrantArena is a live, AI-assisted grant evaluation protocol on GenLayer StudioNet. Funders publish weighted criteria, applicants answer each criterion, independent validators agree on categorical grades, and the contract deterministically computes scores, ranking, and award credits.

## Live deployment

- Contract: `0x9459d5b6e3da734255C5ae6039Ed104d9D74F3B3`
- Network: GenLayer StudioNet (`61999`)
- Deployment transaction: `0xb34fe17f803162072c96b1d34a45c0811a053d1e17f21ef0ff5e42cd1e2ae40f`
- Verified live round: `2`
- Verified consensus proposal: `2`, score `75`, status `QUALIFIED`
- Consensus transaction: `0x04db9488c1778e646e77ff77f076a3fcd60ed01b026cee1261f3a864089a91ae`
- Live funded winner: round `4`, proposal `3`, score `75`, status `FUNDED`; 0.0006 StudioNet test GEN reached the winner wallet after withdrawal.

The machine-readable evidence is in [`deployments/studionet.json`](deployments/studionet.json).

## What users can do

- Browse finalized round and proposal state without a wallet.
- Choose a compatible EVM browser wallet discovered through EIP-6963 or legacy EIP-1193 injection, then create a funded or decision-only round. Wallets that do not support those browser interfaces are not supported by this connector.
- Submit a proposal directly to GenLayer validator consensus.
- See per-criterion grades, a weighted score, status, and public explanation.
- Contest once with an addendum that is not a verbatim resend during the appeal window.
- Finalize expired rounds and withdraw credited awards, bonds, or remainder.

StudioNet is gasless and uses test GEN. The Vercel app needs no paid database or private backend.

## Agent API

Public reads need no API key:

```text
GET  /api/health
GET  /api/rounds?limit=20
GET  /api/rounds?latest=1&limit=20
GET  /api/rounds?id=2
GET  /api/proposals?round=2
GET  /api/proposals?id=2
POST /api/preview
GET  /api/openapi
```

The API is intentionally read-oriented. State-changing actions must be signed by the user or agent wallet and sent directly to the contract, so the Vercel server never possesses funds or keys.

Evidence URLs are references supplied by applicants; this version does not fetch, authenticate, or independently verify their contents. On-chain withdrawal records say `TRANSFER_QUEUED`; check the recipient balance or the external transfer before treating a payout as received.

## Local verification

Requirements: Node.js 24, Python 3.13, `genlayer`, `gltest`, and `genvm-lint`.

```powershell
npm install
npm run verify
```

The five-validator GLSim test expects a local simulator on port `4010`:

```powershell
python tests/run_glsim.py --port 4010 --validators 5 --no-browser
npm run contract:test:integration
```

The live StudioNet check is opt-in because it creates a public round and proposal:

```powershell
$env:RUN_STUDIONET = "1"
npm run contract:test:studionet
```

The funded contest and winner-payout evidence is in [`docs/STUDIONET-AWARD-EVIDENCE-2026-10-01.json`](docs/STUDIONET-AWARD-EVIDENCE-2026-10-01.json). Its live test uses StudioNet test GEN and a Git/Vercel-ignored local canary key.

## Architecture

```text
Browser / AI agent
       │
       ├── keyless reads ──► Vercel Functions ──► StudioNet finalized state
       │
       └── wallet-signed writes ────────────────► GrantArena contract
                                                        │
                             semantic grading ◄── validator consensus
                             ranking + payouts ◄── deterministic contract code
```

The frontend is React and Vite. Vercel Functions provide CORS-enabled public reads and a deterministic pre-submit preview. The Python intelligent contract is the source of truth.

## License

MIT

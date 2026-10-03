# GrantArena

[GrantArena](https://grantarena.vercel.app/) is a grant-round app on GenLayer StudioNet. A funder publishes weighted criteria, applicants answer them, GenLayer validators interpret the answers, and the intelligent contract computes scores, rankings, and test-GEN credits with integer arithmetic. In v2, a funded proposal cannot receive an award until the round's named reviewer wallet attests to that exact proposal version.

## Live deployment and evidence

- StudioNet v2 contract: [`0x1ce8DB3eD235dEdF7e2Ec9E4318EbdD99Ad43F6f`](https://explorer-studio.genlayer.com/address/0x1ce8DB3eD235dEdF7e2Ec9E4318EbdD99Ad43F6f)
- [Deployment transaction](https://explorer-studio.genlayer.com/transactions/0x6b84ffe5624f811f559e69ff99a107ef45d1e581b48eccb6f18b45c82808e9b6)
- [Funded proposal transaction](https://explorer-studio.genlayer.com/transactions/0x4bdb9be1d8967de214442bf80f45eb9c9dce0ac9570fc383c8676243526e6a30), [reviewer attestation](https://explorer-studio.genlayer.com/transactions/0x239c2676e403c5c364ffb9bd4f8bbdb52f5044feb8ad5fc174c149dba96869f1), [finalization](https://explorer-studio.genlayer.com/transactions/0xf6c7e8b0cc47e707f41758669adc87252401373c2ca1405b690cf7613e0f16bc), and [winner withdrawal](https://explorer-studio.genlayer.com/transactions/0x51bc3f0e615c296e883ec8df72b1f9419cc30da4d255d33a4b68f8da29c56716)
- The attested v2 canary credited 0.0006 StudioNet test GEN to the winner wallet. A second, qualified proposal scored 75 but received **zero** because it lacked reviewer attestation; its 0.0001 test-GEN pool returned to the creator. Run `npm run verify:studionet-award` to independently re-read all nine receipts, on-chain state, deployed source, transfer instruction, and current balance. The [positive](docs/STUDIONET-ATTESTED-AWARD-EVIDENCE-2026-10-03.json) and [negative](docs/STUDIONET-UNATTESTED-EVIDENCE-2026-10-03.json) evidence files include the addresses and hashes.

This canary's creator, reviewer, and applicant were separate wallets controlled by the same test operator. It proves the mechanics work, **not** independent human review or the truth of the applicant's claims. StudioNet uses test GEN, not mainnet funds. The prior v1 contract and its [award evidence](docs/STUDIONET-AWARD-EVIDENCE-2026-10-01.json) remain available in [`deployments/studionet-v1.json`](deployments/studionet-v1.json). V1 records are not migrated into v2.

## First-time use

1. Open the website. Browsing rounds and proposal records needs no wallet or API key. Connect an EIP-1193-compatible browser wallet only for a write.
2. A funder creates a decision-only round with a zero pool, or a funded round with StudioNet test GEN. For a funded round, the funder names a separate reviewer wallet they trust. The creator and reviewer cannot apply to their own round.
3. An applicant answers each weighted criterion and, for a funded round, supplies at least one HTTPS reference. Validators score the answers. Empty or repetitive answers have deterministic caps. References are **not** fetched or authenticated by the contract.
4. The named reviewer independently checks the proposal and links, then signs an attestation for the exact on-chain SHA-256 proposal digest. A contest changes the digest and clears the old attestation. The reviewer can revoke before finalization.
5. After the appeal window, anyone can finalize. Only qualified, currently attested proposals can receive funded awards. Unallocated pool funds return to the creator's claimable balance. Winners and creators withdraw credits through their own wallets and verify actual external credit.

A reviewer signature is accountable, but one person can control multiple wallets. GrantArena cannot establish identity, reviewer independence, or real-world truth from a signature or URL. Funders must decide whom to trust. The [security boundary](docs/SECURITY-V2-ARCHITECTURE.md) explains the design and remaining limits.

## Agent API

The public API is keyless and read-only:

```text
GET  /api/health
GET  /api/rounds?latest=1&limit=20
GET  /api/rounds?id=1
GET  /api/proposals?round=1
GET  /api/proposals?id=1
POST /api/preview
GET  /api/openapi
```

Round responses include the named reviewer; proposal responses include scores, evidence URLs, digest, attestation wallet/note/time, and award. Agents may read and assess these records, but state-changing calls must be signed by an agent-controlled or user-controlled StudioNet wallet directly against the intelligent contract. Vercel never holds a signing key or grant funds.

## Reproduce checks

Requirements: Node.js 24, Python 3.13, `genlayer`, `gltest`, and `genvm-lint`.

```powershell
npm install
npm run verify
npm run verify:studionet-award
```

`npm run verify` runs GenVM lint, strict typecheck, direct contract tests, web/API tests, and a production build. `npm run verify:studionet-award` is read-only and needs no key. The five-validator simulation uses a local GLSim server:

```powershell
python tests/run_glsim.py --port 4010 --validators 5 --no-browser
npm run contract:test:integration
```

The opt-in `tests/integration/test_studionet_v2.py` creates a fresh contract and sends StudioNet test-GEN transactions; it is not part of the default suite. The existing [test record](docs/STUDIONET-ATTESTED-AWARD-EVIDENCE-2026-10-03.json) and read-only verifier let reviewers inspect the deployed run without generating duplicate transactions.

## Architecture

```text
Browser / AI agent ── keyless reads ──► Vercel Functions ──► finalized StudioNet state
        │
        └── wallet-signed writes ───────────────► GrantArena intelligent contract
                                                    ├─ validator interpretation
                                                    ├─ deterministic caps/ranking
                                                    └─ reviewer-gated funded credits
```

The frontend is React/Vite; the Python intelligent contract is the source of truth. This repository is MIT licensed.

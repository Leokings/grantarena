# GrantArena verification record

Verified on 2026-10-01 against contract `0x9459d5b6e3da734255C5ae6039Ed104d9D74F3B3` and production site `https://grantarena.vercel.app`.

## Contract checks

| Check | Result |
| --- | --- |
| GenVM lint | Passed: 3 checks, 14 public methods found |
| Strict GenVM typecheck | Passed: 0 errors, 0 warnings |
| Direct security/state tests | Passed: 16/16 |
| Five-validator GLSim integration | Passed: 1/1 |
| Live StudioNet integration | Passed: 1/1 |
| Live StudioNet funded cancellation + withdrawal | Passed: 1/1; 0.001 test GEN entered the contract and returned to the owner |
| Live StudioNet contest + funded winner payout | Passed: 1/1; proposal #3 contested, round #4 finalized, 0.0006 test GEN credited to winner and 0.0004 returned to creator |
| Deployed source equality | Passed: SHA-256 hashes match |
| Deployed schema | Passed: required read/write methods present |

The direct suite includes invalid input bounds, duplicate prevention, score caps, proposer permissions, contest restrictions, cancellation restrictions, ranking/tie-break behavior, exact payout slots, credits, withdrawals, and accounting invariants. The suite found an early payout-slot defect; the implementation was corrected before deployment and the regression is covered.

## Live consensus evidence

- Deployment: `0xb34fe17f803162072c96b1d34a45c0811a053d1e17f21ef0ff5e42cd1e2ae40f`
- Round creation: `0x254904fc7e2bd308a6a1e9db99d1b0310e34b9a4ae3dedc876457873df8c1393`
- Proposal submission: `0x04db9488c1778e646e77ff77f076a3fcd60ed01b026cee1261f3a864089a91ae`
- Consensus: `MAJORITY_AGREE`
- Observed result: proposal 2, `QUALIFIED`, score 75, grades `STRONG / STRONG`
- Source hash: `0908b0266021d294b19e8285020a4141f9b476b7981ff21f6f83f76597ad75a8`

## Funded-flow evidence

- Live round: `3`, funded with `0.001` StudioNet test GEN and later `CANCELLED`
- Owner: `0xa2B9c4903921a1EBEcd63Dd84F13431829B57719`
- Cancellation transaction: `0x9c63119ea69dcad45bec0f15f0024c7ca2e1759eda75adb40bd22043fc756243`
- Withdrawal transaction: `0xa36f07a9f1104d18c6f328b067a2188d694b2e651a8a2629d0b6c1eee925a718`
- Final withdrawal record: `TRANSFER_QUEUED`, amount `1000000000000000` atto GEN
- Owner balance after creating round: `0.004` test GEN; after withdrawal: `0.005` test GEN
- The create transaction hash was not captured because StudioNet returned a transient HTTP 502 while polling its receipt. The finalized round state and pool were read back from the deployed contract.

## Contest and winner-payout evidence

- Round #4, proposal #3: live contest finalized; score `75`, then proposal became `FUNDED` when the appeal window closed.
- Create: `0xb1e8d3ec959e205b99ea18ab67d9a1104dc2453c0018f2a801fa648311aafc71`
- Submit: `0x416df224c9f1b97074f2f4e0243941f766934347c2745e45e480ae091b9b980e`
- Contest: `0x8696ff21f9b09fc55606849a03712dbbf7177017135fb57f929bfb476735aaf5`
- Finalize: `0xe77acf7e046b74f0a7a8d427c031fad110a0537a5f687d48110e7b79916cc8cb`
- Winner withdrawal: `0x9f996013d5caf0a3c132c5364699f0e1a081a47aae7a6c8e1c832fb103bdfa39`
- Creator remainder withdrawal: `0x27ca40d248ab6f0a9d662e89b04d96821d35c50427ecc849da8c7a259b614455`
- Recipient balance: `0` → `0.0006` StudioNet test GEN; creator balance: `0.005` → `0.0044` after staking `0.001` and recovering the `0.0004` remainder.
- All six transaction receipts finalized with successful execution. The live test and a read-only rerun both passed. Machine-readable evidence: [`STUDIONET-AWARD-EVIDENCE-2026-10-01.json`](STUDIONET-AWARD-EVIDENCE-2026-10-01.json).

## Web checks

| Check | Result |
| --- | --- |
| TypeScript production build | Passed |
| Web/API unit tests | Passed: 23/23 |
| Vercel deployment | Ready |
| Production HTTP/API verifier | Passed: 19/19 checks |
| Homepage identity and HTTP 200 | Passed |
| StudioNet health read | Passed |
| Live round and proposal reads | Passed |
| OpenAPI endpoint | Passed |
| Deterministic preview endpoint | Passed |
| Invalid input returns HTTP 400 | Passed |
| CSP and `nosniff` headers | Passed |
| Desktop visual/interaction pass | Passed |
| Mobile 390px overflow check | Passed: `scrollWidth === innerWidth` |
| Mobile navigation | Rounds, Create, Apply, and For agents visible; agent panel reached at 390px |
| Browser console | No errors after the final UI deployment |
| Create, Apply, Rounds, Agent navigation | Passed |
| Proposal completeness reacts to answers | Passed: 25 → 100 ceiling |
| Missing-wallet guidance | Passed with no error in the corrected production bundle |
| Finalized rollback treated as failure | Passed with real-shaped receipt regression fixture |
| Transient StudioNet RPC failure during finality polling | Retried; transaction link retained on an unverified result |
| Wallet account/network changes | Passed with injected-provider event tests |
| Oversized chunked preview body | Rejected with HTTP 413 in unit test |
| Production dependency audit | 0 known vulnerabilities in `npm audit --omit=dev` |
| Multi-wallet discovery | EIP-6963 and legacy EIP-1193 paths tested; Chrome detected OKX once and opened its real connection approval prompt |
| Real wallet approval | Passed: user approved OKX Wallet; site showed connected account `0x6303…F38e`, and provider reported StudioNet chain ID `0xf22f` (61999) |
| No-credit withdrawal action | Hidden for the connected account after reading its finalized claimable balance; no withdrawal transaction was sent |

## Reproduce

```powershell
npm run verify
node scripts/verify-production.mjs https://grantarena.vercel.app
```

The live StudioNet test is opt-in because it creates permanent public records:

```powershell
$env:RUN_STUDIONET = "1"
npm run contract:test:studionet
```

The funded canary is separately opt-in because it transfers StudioNet test GEN. Its generated wallet key is saved in a Git-ignored `.env.funded-canary` file so an interrupted test can be resumed. A transient StudioNet 502 interrupted the first receipt poll; the round was confirmed finalized on readback and the cancellation/withdrawal phase was resumed with `CANARY_ROUND_ID=3`.

The contest/payout test is opt-in and uses 0.001 StudioNet test GEN from the existing local canary wallet. It does not use real GEN:

```powershell
$env:RUN_STUDIONET_AWARD = "1"
gltest tests/integration/test_studionet_award.py -v -s --network studionet
```

An earlier setup attempt sent 0.005 StudioNet test GEN to a disposable account before the test discovered it was pointed at localnet. That account's key was not retained. The current RPC balance for that address is zero, so that attempt is not counted as funded-flow evidence. No real GEN was involved; the canary now persists its test key and the final Vercel deployment explicitly excludes `.env*` files.

## Honest boundary

The wallet-less browser path, multi-wallet discovery, user-approved OKX connection, live API, public reads, contract writes, validator consensus, live contest, funded settlement, and actual winner/creator wallet credits were tested. The connected OKX account and StudioNet chain ID were independently read from the provider. No transaction was requested from the user's OKX Wallet; wallet-signed writes were tested with separate StudioNet canary accounts. EIP-6963 and legacy provider discovery have automated tests; this is not a guarantee of compatibility with every wallet. StudioNet availability is external to the app; one transient 502 occurred during the earlier canary. No security review can guarantee there are no flaws.

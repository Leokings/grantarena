# GrantArena v2 verification — 2026-10-03

Scope: current intelligent contract, scoring and attestation boundary, React client, public API, StudioNet settlement, and deployed source identity. This is an engineering audit and test record, not an independent security certification. The [v1 verification record](TESTING-V1-2026-10-01.md) and [v1 contract deployment](../deployments/studionet-v1.json) are historical.

## Results

| Check | Result |
| --- | --- |
| GenVM lint | Passed, 3 checks; 16 public methods |
| Strict GenVM typecheck | Passed, 0 diagnostics |
| Direct contract tests | 23 passed |
| Web/API unit tests | 25 passed |
| TypeScript/Vite production build | Passed |
| Five-validator GLSim integration | Passed, 1 test |
| StudioNet v2 funded flow | Passed: deploy, round creation, consensus proposal, signed review, finalization, withdrawal and recipient-balance readback |
| StudioNet v2 no-attestation flow | Passed: a proposal scored 75 but received zero award; the full 0.0001 test-GEN pool returned to the creator's claimable balance |
| Deployed code identity | Local and StudioNet source SHA-256 match: `097fac35c308b9290f25d6074122f25dc8303a8aa9d3d90f0a75acb6d9665a46` |
| Read-only StudioNet evidence verifier | Passed: 9 finalized, successfully executed transactions plus current state/balance readback |
| Production Vercel deployment | Promoted deployment `dpl_36e1ypUCe2iUmMgyFA3gLjFicP6P` to `https://grantarena.vercel.app` |
| Production HTTP/API | Passed: 21 checks covering homepage, headers, v2 health, paid and unpaid round/proposal readback, latest pagination, preview, OpenAPI, invalid inputs and absence of the test route |
| Production browser | Passed: both live rounds and signed/unsigned outcomes rendered; evidence details opened; expected missing-wallet message shown; no error overlay or console logs after clean reload |
| 390px mobile browser | Passed: `scrollWidth === innerWidth`; Rounds, Create, Apply and For agents remained visible; agent panel opened |
| API route exposure | Former `/api/preview.test` test file moved outside `api`; production now returns HTTP 404 for that path |

The 23 direct tests cover funding and accounting, validation boundaries, score caps, rankings, contest limits, finalization timing, withdrawal, and v2 cases: no attestation means no funded payout; only the named reviewer can attest; digest mismatch is rejected; a contest invalidates prior attestation; revocation removes eligibility; and repetitive filler has a low deterministic cap. Direct mocks do **not** establish that an LLM resists every prompt injection.

The GLSim run used five mock validators and a decision-only round. It verifies transaction execution and consensus wiring but does not validate external sources. The opt-in StudioNet run used 0.001 **test** GEN and separate creator/applicant/reviewer wallet addresses. All three were derived from a recoverable key controlled by one operator. This proves the signature/payout mechanics, **not** independent human review.

## StudioNet evidence

- Contract: [`0x1ce8DB3eD235dEdF7e2Ec9E4318EbdD99Ad43F6f`](https://explorer-studio.genlayer.com/address/0x1ce8DB3eD235dEdF7e2Ec9E4318EbdD99Ad43F6f)
- [Deployment](https://explorer-studio.genlayer.com/transactions/0x6b84ffe5624f811f559e69ff99a107ef45d1e581b48eccb6f18b45c82808e9b6)
- [Funded round](https://explorer-studio.genlayer.com/transactions/0x223bffb0365f4496687c039d770d78b6b1b170689e0bc4c40fdb5d25ec3b5b75)
- [Proposal and validator interpretation](https://explorer-studio.genlayer.com/transactions/0x4bdb9be1d8967de214442bf80f45eb9c9dce0ac9570fc383c8676243526e6a30)
- [Reviewer attestation](https://explorer-studio.genlayer.com/transactions/0x239c2676e403c5c364ffb9bd4f8bbdb52f5044feb8ad5fc174c149dba96869f1)
- [Finalization](https://explorer-studio.genlayer.com/transactions/0xf6c7e8b0cc47e707f41758669adc87252401373c2ca1405b690cf7613e0f16bc)
- [Winner withdrawal](https://explorer-studio.genlayer.com/transactions/0x51bc3f0e615c296e883ec8df72b1f9419cc30da4d255d33a4b68f8da29c56716)

Round #1 finalized with proposal #1 funded for `600000000000000` atto test GEN. The winner balance was `0` before withdrawal and `600000000000000` afterward. The creator's `400000000000000` atto remainder is claimable on-chain. The [evidence JSON](STUDIONET-ATTESTED-AWARD-EVIDENCE-2026-10-03.json) contains every hash and address. `npm run verify:studionet-award` independently re-reads GenLayer receipts and state, the deployed source, transfer instruction and current winner balance; it does not merely trust the JSON flags.

Round #2 deliberately had no reviewer attestation. Proposal #2 scored 75 and was qualified, but finalization selected no winner, allocated zero, and returned the full `100000000000000` atto pool. The [negative-case evidence](STUDIONET-UNATTESTED-EVIDENCE-2026-10-03.json) and the same read-only verifier confirm this result.

## Reproduce

```powershell
npm install
npm run verify
npm run verify:studionet-award
```

For the five-validator local simulation, start `python tests/run_glsim.py --port 4010 --validators 5 --no-browser` in one terminal, then run `npm run contract:test:integration` in another.

The opt-in live test is `tests/integration/test_studionet_v2.py` with `RUN_STUDIONET_V2=1` and `--network studionet`; it creates permanent public StudioNet records and uses test GEN. Do not rerun merely to verify the existing award—use the read-only script instead.

## Remaining limits

- The intelligent contract cannot authenticate applicant URLs or real-world claims. The reviewer signature is a payout gate and accountable statement, not proof of truth or reviewer independence.
- Deterministic token caps and JSON prompt boundaries reduce simple padding/delimiter attacks; they cannot guarantee immunity to adversarial language or model error.
- A `TRANSFER_QUEUED` withdrawal record alone is insufficient to prove recipient credit. The canary additionally observed a matching external transfer instruction and recipient balance increase. The balance may change later.
- No real user-wallet transaction was requested for v2. The canary used operator-controlled StudioNet test wallets.
- StudioNet is a developer network. RPC availability and validator results can vary, and the code is not certified for mainnet custody.

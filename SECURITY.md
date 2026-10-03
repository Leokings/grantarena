# Security policy

GrantArena v2 is a GenLayer **StudioNet** application using test GEN. It has not been independently audited for mainnet custody; do not send real assets to it.

The contract deterministically bounds inputs, score caps, ranking, payout arithmetic, account credits, and appeal timing. Validators independently evaluate criterion grades. Applicant URLs and all rubric/proposal text are untrusted; URLs are not fetched or authenticated by the contract. A funded proposal must supply at least one URL and receive a signature from the round's named reviewer wallet for its exact proposal digest before it can receive an award. A contest invalidates that signature. The reviewer can revoke it before finalization. Unallocated pool funds return to the creator.

The reviewer wallet must differ from the creator and applicants, but wallet separation is not proof of human independence. The reviewer can attest dishonestly or fail to review sources. The contract's lexical novelty and distinct-word caps reduce simple padding, but cannot eliminate semantic plagiarism, fabricated claims, prompt injection, model error, or consensus-model bias. AI grades are evaluations, not evidence of truth. See [the v2 boundary](docs/SECURITY-V2-ARCHITECTURE.md).

Withdrawals record a queued external transfer, not a permanent proof of receipt. Check the transfer instruction and recipient balance. The [v2 read-only verifier](scripts/verify-studionet-v2.mjs) rechecks the published canary's finality, signed reviewer, on-chain state, deployed source, and balance without relying on its JSON assertions. The canary wallets share a test operator and do not demonstrate an independent real-world reviewer.

Report suspected vulnerabilities privately to the repository owner with the contract address, method, reproduction steps, and impact. Please do not publish an unpatched exploit.

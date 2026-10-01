# Security policy

GrantArena is live on GenLayer StudioNet. It has not been deployed for mainnet custody. Do not treat test GEN as real money.

## Contract safeguards

- AI assigns one of five categorical grades per criterion and writes a summary. Score arithmetic, caps, ranking, tie-breaks, and payout allocation are deterministic.
- Validators rerun the evaluation, and the equivalence check compares the complete ordered grade list; summaries are not part of that check.
- Proposal text is explicitly delimited as untrusted data in the validator prompt.
- Empty and short answers have deterministic score ceilings of 25 and 50.
- Criteria, proposal counts, evidence links, winners, durations, text, pools, and bonds are bounded.
- A creator cannot cancel a round after its first proposal.
- Proposers can contest once during the appeal window. The contract rejects an exact resend of existing text; it cannot prove semantic novelty.
- Funds use pull credits and accounting invariants; no private key is stored by the website.

The contract does not fetch or authenticate applicant-supplied evidence URLs. Withdrawal records remain `TRANSFER_QUEUED` and do not independently prove that the external recipient was paid; confirm the balance or child transfer. This is a StudioNet test deployment, not an audited mainnet custody product.

## Reporting

Do not publish an unpatched exploit. Include the contract address, affected method, reproduction steps, and impact in a private report to the repository owner.

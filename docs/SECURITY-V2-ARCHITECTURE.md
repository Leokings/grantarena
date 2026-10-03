# GrantArena v2 security boundary

GrantArena is a StudioNet test-GEN grant protocol. A model interprets applicant text against a funder's rubric; it does not authenticate web pages, organization identities, historical results, or independence of reviewers. A submitted HTTPS URL is a reference, not proof.

For a funded round, the creator names a reviewer wallet distinct from the creator and from applicants. The contract stores a SHA-256 digest of the exact proposal version (round/proposal IDs, title, summary, answers, URLs, and contest addendum). Only the named reviewer can attest to that digest. A contest changes the digest and clears any previous attestation. At finalization, only qualified proposals with a current attestation are eligible for funded awards. Unallocated test GEN is credited back to the creator. Decision-only rounds can still rank proposals without a reviewer.

The attestation is an accountable signature and a payout gate, not a cryptographic proof that applicant claims are true. One person may control multiple wallets; the contract cannot prove reviewer independence. Funders must choose reviewers they trust and assess the sources. A reviewer can withhold an attestation, leaving a qualified proposal unfunded. The website and API expose the reviewer, digest, status, note, and timestamp so users can see this limitation.

The AI prompt serializes untrusted data as JSON and explicitly treats URLs as unauthenticated. Deterministic answer caps consider word count and distinct words, not just character count. Contests require a material number and fraction of new tokens, but semantic paraphrases or fabricated claims cannot be completely ruled out by these rules. The persisted explanation is generated from accepted grades rather than unchecked model prose. The validator still independently re-runs grading under GenLayer consensus.

For prior v1 award evidence, `scripts/verify-studionet-award.mjs` checks transaction finality and execution, signed sender, contract recipient, deposit value, transfer instructions, current on-chain round/proposal/accounting state, and current winner balance against StudioNet. This checks that a test-GEN award occurred; it does not authenticate the canary applicant's underlying project claims.

V1 remains independently accessible at its existing contract address. V2 requires a new deployment because on-chain contract state is not upgraded in place. The site must not point to V2 until a funded and an unfunded path have been tested on StudioNet, and users must not confuse v1 records with v2 records.

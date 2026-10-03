import { describe, expect, it } from 'vitest';
import { parseProposal, parseRound } from './records';

const reviewer = '0x2dfee6a51106123c5e52bb975e301c0a1b16499b';
const digest = '79be3964561730ca19862a23e826138aa5c0afd741978f6c80b35fd8fe928f66';

describe('v2 on-chain record parsing', () => {
  it('exposes the reviewer who controls funded eligibility', () => {
    const round = parseRound({
      schema: 'grantarena/round/v2', round_id: 1, round_key: 'reviewed-award-v2',
      creator: '0xa2b9c4903921a1ebecd63dd84f13431829b57719', reviewer,
      title: 'Reviewed award', mission: 'A transparent funded round with a signed evidence review.',
      submission_deadline: 1791007284, appeal_deadline: 1791007344,
      winner_count: 1, minimum_score: 25, proposal_bond_atto: 0,
      criteria: [{ id: 'impact', label: 'Public impact', description: 'Explain a measurable public outcome.', weight: 100 }],
      payout_bps: [10000], pool_atto: '1000000000000000', proposal_ids: [1],
      proposal_count: 1, qualified_count: 1, winner_ids: [1], status: 'FINALIZED',
      created_at: 1791007108, finalized_at: 1791007351,
      allocated_atto: '600000000000000', returned_atto: '400000000000000',
    });
    expect(round.reviewer).toBe(reviewer);
    expect(round.allocatedAtto).toBe('600000000000000');
  });

  it('exposes an exact signed digest and rejects a missing attestation field', () => {
    const raw = {
      schema: 'grantarena/proposal/v2', proposal_id: 1, round_id: 1,
      proposal_key: 'public-dashboard', proposer: '0xcd83817069693fbac4b98e83d574d890d64d7ba8',
      title: 'Public dashboard', summary: 'A public dashboard with open metrics for its pilot.',
      requested_atto: '600000000000000', answers: { impact: 'A complete response.' },
      evidence_urls: ['https://github.com/genlayerlabs'], grades: ['STRONG'],
      criterion_scores: [75], weighted_score: 75, evaluation_summary: 'Automated rubric grades: Public impact: STRONG.',
      status: 'FUNDED', bond_atto: 0, contest_used: false, contest_addendum: '',
      evidence_digest: digest, attested_by: reviewer, attested_digest: digest,
      attested_at: 1791007219, attestation_note: 'The signed reviewer checked the exact proposal digest before payout.',
      rank: 1, award_atto: '600000000000000', submitted_at: 1791007148,
    };
    expect(parseProposal(raw).attestedDigest).toBe(digest);
    expect(parseProposal(raw).attestedBy).toBe(reviewer);
    expect(() => parseProposal({ ...raw, attested_digest: undefined })).toThrow(/attested digest/);
  });
});

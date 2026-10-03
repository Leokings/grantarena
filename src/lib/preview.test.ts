import { describe, expect, it } from 'vitest';
import { answerCap, contractTextError, previewProposal } from './preview';

const criteria = [
  { id: 'impact', label: 'Impact', description: 'Describe a measurable public outcome.', weight: 60 },
  { id: 'delivery', label: 'Delivery', description: 'Describe milestones and delivery risks.', weight: 40 },
];

describe('proposal preview', () => {
  it('mirrors the contract word and distinct-word caps', () => {
    expect(answerCap('')).toBe(0);
    expect(answerCap('specific but short')).toBe(25);
    expect(answerCap('x'.repeat(80))).toBe(25);
    expect(answerCap('One clear result will be published for every participating maintainer after a six week pilot.')).toBe(50);
    expect(answerCap('The project gives community maintainers a public dashboard for dependency health and measures progress with monthly usage, confirmed alerts resolved, response times, independent checks, and published reports across six months.')).toBe(100);
  });

  it('computes the weighted maximum before consensus', () => {
    const result = previewProposal({
      criteria,
      answers: {
        impact: 'The project gives community maintainers a public dashboard for dependency health and measures progress with monthly usage, confirmed alerts resolved, response times, independent checks, and published reports across six months.',
        delivery: 'short',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.maximumWeightedScore).toBe(70);
  });

  it('rejects mismatched answers and invalid weights', () => {
    const result = previewProposal({
      criteria: [{ ...criteria[0], weight: 59 }, criteria[1]],
      answers: { impact: 'x', extra: 'not declared' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Criterion weights must total 100.');
    expect(result.errors).toContain('Answer for “delivery” is missing.');
  });

  it('rejects non-ASCII and control characters before a wallet transaction', () => {
    expect(contractTextError('Plain text', 'Title', 4, 100)).toBeNull();
    expect(contractTextError('Café', 'Title', 4, 100)).toContain('ASCII');
    const result = previewProposal({
      criteria,
      answers: { impact: 'A credible answer with an emoji 🚀', delivery: 'line\twith tab' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

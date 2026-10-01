import { describe, expect, it } from 'vitest';
import endpoint from './preview';

const criteria = [
  { id: 'impact', label: 'Impact', description: 'Describe a measurable public outcome.', weight: 60 },
  { id: 'delivery', label: 'Delivery', description: 'Describe milestones and delivery risks.', weight: 40 },
];

describe('preview API request boundary', () => {
  it('accepts a bounded preview request', async () => {
    const response = await endpoint.fetch(new Request('https://example.test/api/preview', {
      method: 'POST',
      body: JSON.stringify({ criteria, answers: { impact: 'x'.repeat(80), delivery: 'x'.repeat(80) } }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).preview.maximumWeightedScore).toBe(100);
  });

  it('rejects an oversized body even without Content-Length', async () => {
    const request = new Request('https://example.test/api/preview', {
      method: 'POST',
      body: JSON.stringify({ criteria, answers: { impact: 'x'.repeat(33_000), delivery: '' } }),
    });
    expect(request.headers.has('content-length')).toBe(false);
    const response = await endpoint.fetch(request);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('BODY_TOO_LARGE');
  });
});

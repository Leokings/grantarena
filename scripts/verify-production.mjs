import process from 'node:process';

const base = (process.argv[2] || process.env.GRANTARENA_URL || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  throw new Error('Pass the production URL: node scripts/verify-production.mjs https://example.vercel.app');
}

const checks = [];
function check(name, condition, detail = '') {
  if (!condition) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  checks.push(name);
}

const page = await fetch(base, { redirect: 'follow' });
const html = await page.text();
check('homepage status', page.status === 200, String(page.status));
check('homepage identity', html.includes('GrantArena'));
check('content security policy', Boolean(page.headers.get('content-security-policy')));
check('nosniff header', page.headers.get('x-content-type-options') === 'nosniff');

const healthResponse = await fetch(`${base}/api/health`);
const health = await healthResponse.json();
check('health status', healthResponse.status === 200 && health.ok === true, JSON.stringify(health));
check('contract address', health.contract?.address?.toLowerCase() === '0x1ce8db3ed235dedf7e2ec9e4318ebdd99ad43f6f');
check('contract version', health.contract?.version === 'grantarena/v2' && health.apiVersion === '2.0.0');

const roundsResponse = await fetch(`${base}/api/rounds?limit=20`);
const rounds = await roundsResponse.json();
check('rounds endpoint', roundsResponse.status === 200 && Array.isArray(rounds.rounds));
check('attested round readable', rounds.rounds.some((round) => String(round.roundId) === '1'));

const latestResponse = await fetch(`${base}/api/rounds?latest=1&limit=1`);
const latest = await latestResponse.json();
check('latest-page endpoint', latestResponse.status === 200
  && latest.rounds?.length === 1
  && String(latest.rounds[0].roundId) === String(health.contract.roundCount));

const canaryResponse = await fetch(`${base}/api/rounds?id=1`);
const canary = await canaryResponse.json();
check('attested funded round readback', canaryResponse.status === 200
  && String(canary.round?.roundId) === '1'
  && canary.round?.status === 'FINALIZED'
  && canary.round?.reviewer?.toLowerCase() === '0x2dfee6a51106123c5e52bb975e301c0a1b16499b'
  && canary.round?.poolAtto === '1000000000000000'
  && canary.round?.allocatedAtto === '600000000000000'
  && canary.round?.returnedAtto === '400000000000000');

const proposalsResponse = await fetch(`${base}/api/proposals?round=1`);
const proposals = await proposalsResponse.json();
check('proposals endpoint', proposalsResponse.status === 200 && Array.isArray(proposals.proposals));
const awarded = proposals.proposals?.find((proposal) => String(proposal.proposalId) === '1');
check('signed review and funded winner readable', proposalsResponse.status === 200
  && awarded?.contestUsed === false
  && awarded?.status === 'FUNDED'
  && awarded?.awardAtto === '600000000000000'
  && awarded?.evidenceDigest === '79be3964561730ca19862a23e826138aa5c0afd741978f6c80b35fd8fe928f66'
  && awarded?.attestedDigest === awarded.evidenceDigest
  && awarded?.attestedBy?.toLowerCase() === canary.round?.reviewer?.toLowerCase());

const unreviewedRoundResponse = await fetch(`${base}/api/rounds?id=2`);
const unreviewedRound = await unreviewedRoundResponse.json();
check('unreviewed round returned the pool', unreviewedRoundResponse.status === 200
  && unreviewedRound.round?.status === 'FINALIZED'
  && unreviewedRound.round?.winnerIds?.length === 0
  && unreviewedRound.round?.allocatedAtto === '0'
  && unreviewedRound.round?.returnedAtto === '100000000000000');
const unreviewedProposalResponse = await fetch(`${base}/api/proposals?id=2`);
const unreviewedProposal = await unreviewedProposalResponse.json();
check('qualified but unsigned proposal was not paid', unreviewedProposalResponse.status === 200
  && unreviewedProposal.proposal?.status === 'QUALIFIED'
  && unreviewedProposal.proposal?.weightedScore === 75
  && unreviewedProposal.proposal?.attestedAt === '0'
  && unreviewedProposal.proposal?.awardAtto === '0');

const openapiResponse = await fetch(`${base}/api/openapi`);
const openapi = await openapiResponse.json();
check('OpenAPI document', openapiResponse.status === 200 && openapi.openapi === '3.1.0' && openapi.info?.title === 'GrantArena API' && openapi.info?.version === '2.0.0');

const previewResponse = await fetch(`${base}/api/preview`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    criteria: [
      { id: 'impact', label: 'Impact', description: 'Describe a measurable public outcome.', weight: 60 },
      { id: 'delivery', label: 'Delivery', description: 'Describe milestones and delivery risks.', weight: 40 },
    ],
    answers: {
      impact: 'The project gives community maintainers a public dashboard for dependency health and measures progress with monthly usage, confirmed alerts resolved, response times, independent checks, and published reports across six months.',
      delivery: 'A named two-person team will ship an indexer, dashboard, and documented API in three milestones with weekly source releases, acceptance tests for malformed inputs, a public timeline, and a fallback for provider outages.',
    },
  }),
});
const preview = await previewResponse.json();
check('preview endpoint', previewResponse.status === 200 && preview.preview?.maximumWeightedScore === 100);

const invalidRound = await fetch(`${base}/api/rounds?id=not-a-number`);
check('invalid input rejected', invalidRound.status === 400);
const invalidPage = await fetch(`${base}/api/rounds?latest=1&offset=0`);
check('ambiguous pagination rejected', invalidPage.status === 400);
const oversizedPreview = await fetch(`${base}/api/preview`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ criteria: [], answers: { impact: 'x'.repeat(33_000) } }),
});
check('oversized preview rejected', oversizedPreview.status === 413);
const leakedTestRoute = await fetch(`${base}/api/preview.test`);
check('test file not deployed as API', leakedTestRoute.status === 404);

console.log(JSON.stringify({
  ok: true,
  baseUrl: base,
  contract: health.contract.address,
  verifiedRound: 1,
  awardedProposal: { id: 1, score: awarded.weightedScore, status: awarded.status },
  checks,
}, null, 2));

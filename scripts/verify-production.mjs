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
check('contract address', health.contract?.address?.toLowerCase() === '0x9459d5b6e3da734255c5ae6039ed104d9d74f3b3');

const roundsResponse = await fetch(`${base}/api/rounds?limit=20`);
const rounds = await roundsResponse.json();
check('rounds endpoint', roundsResponse.status === 200 && Array.isArray(rounds.rounds));
check('verified round readable', rounds.rounds.some((round) => String(round.roundId) === '2'));

const latestResponse = await fetch(`${base}/api/rounds?latest=1&limit=1`);
const latest = await latestResponse.json();
check('latest-page endpoint', latestResponse.status === 200
  && latest.rounds?.length === 1
  && String(latest.rounds[0].roundId) === String(health.contract.roundCount));

const canaryResponse = await fetch(`${base}/api/rounds?id=3`);
const canary = await canaryResponse.json();
check('funded canary readback', canaryResponse.status === 200
  && String(canary.round?.roundId) === '3'
  && canary.round?.status === 'CANCELLED'
  && canary.round?.poolAtto === '1000000000000000');

const proposalsResponse = await fetch(`${base}/api/proposals?round=2`);
const proposals = await proposalsResponse.json();
check('proposals endpoint', proposalsResponse.status === 200 && Array.isArray(proposals.proposals));
const verified = proposals.proposals.find((proposal) => String(proposal.proposalId) === '2');
check('verified proposal readable', verified?.weightedScore === 75 && verified?.status === 'QUALIFIED', JSON.stringify(verified));

const awardRoundResponse = await fetch(`${base}/api/rounds?id=4`);
const awardRound = await awardRoundResponse.json();
check('funded award round readable', awardRoundResponse.status === 200
  && awardRound.round?.status === 'FINALIZED'
  && awardRound.round?.allocatedAtto === '600000000000000'
  && awardRound.round?.returnedAtto === '400000000000000'
  && awardRound.round?.winnerIds?.includes('3'));

const awardProposalsResponse = await fetch(`${base}/api/proposals?round=4`);
const awardProposals = await awardProposalsResponse.json();
const awarded = awardProposals.proposals?.find((proposal) => String(proposal.proposalId) === '3');
check('contested funded winner readable', awardProposalsResponse.status === 200
  && awarded?.contestUsed === true
  && awarded?.status === 'FUNDED'
  && awarded?.weightedScore === 75
  && awarded?.awardAtto === '600000000000000');

const openapiResponse = await fetch(`${base}/api/openapi`);
const openapi = await openapiResponse.json();
check('OpenAPI document', openapiResponse.status === 200 && openapi.openapi === '3.1.0' && openapi.info?.title === 'GrantArena API');

const previewResponse = await fetch(`${base}/api/preview`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    criteria: [
      { id: 'impact', label: 'Impact', description: 'Describe a measurable public outcome.', weight: 60 },
      { id: 'delivery', label: 'Delivery', description: 'Describe milestones and delivery risks.', weight: 40 },
    ],
    answers: { impact: 'x'.repeat(80), delivery: 'x'.repeat(80) },
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

console.log(JSON.stringify({
  ok: true,
  baseUrl: base,
  contract: health.contract.address,
  verifiedRound: 2,
  verifiedProposal: { id: 2, score: verified.weightedScore, status: verified.status },
  awardRound: 4,
  awardedProposal: { id: 3, score: awarded.weightedScore, status: awarded.status },
  checks,
}, null, 2));

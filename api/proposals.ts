import { STUDIONET_CONTRACT_ADDRESS } from '../src/lib/public-config.js';
import { readProposal, readRoundProposals } from '../src/server/genlayer-read.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30',
  'X-Content-Type-Options': 'nosniff',
};

function idFrom(value: string | null) {
  return value && /^[1-9]\d{0,18}$/.test(value) ? BigInt(value) : null;
}

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') {
      return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
    }
    const url = new URL(request.url);
    const id = idFrom(url.searchParams.get('id'));
    const roundId = idFrom(url.searchParams.get('round'));
    if ((id === null && roundId === null) || (id !== null && roundId !== null)) {
      return Response.json({
        ok: false,
        error: 'SELECT_ONE_LOOKUP',
        message: 'Use either ?id=1 or ?round=1.',
      }, { status: 400, headers });
    }
    try {
      const payload = id !== null
        ? { proposal: await readProposal(id) }
        : await readRoundProposals(roundId as bigint);
      return Response.json({ ok: true, contract: STUDIONET_CONTRACT_ADDRESS, ...payload }, { headers });
    } catch (error) {
      return Response.json({
        ok: false,
        error: 'PROPOSAL_DATA_NOT_FOUND',
        message: error instanceof Error ? error.message : 'The proposal data could not be read.',
      }, { status: 404, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
  },
};

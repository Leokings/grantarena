import { STUDIONET_CONTRACT_ADDRESS } from '../src/lib/public-config.js';
import { readRound, readRounds } from '../src/server/genlayer-read.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30',
  'X-Content-Type-Options': 'nosniff',
};

function positiveInteger(value: string | null) {
  return value && /^[1-9]\d{0,18}$/.test(value) ? BigInt(value) : null;
}

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') {
      return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
    }
    const url = new URL(request.url);
    const requestedId = url.searchParams.get('id');
    try {
      if (requestedId !== null) {
        const id = positiveInteger(requestedId);
        if (id === null) {
          return Response.json({ ok: false, error: 'INVALID_ROUND_ID' }, { status: 400, headers });
        }
        return Response.json({
          ok: true,
          contract: STUDIONET_CONTRACT_ADDRESS,
          round: await readRound(id),
        }, { headers });
      }
      const offsetRaw = url.searchParams.get('offset') ?? '0';
      const limitRaw = url.searchParams.get('limit') ?? '20';
      const latestRaw = url.searchParams.get('latest');
      if (!/^\d{1,6}$/.test(offsetRaw) || !/^\d{1,2}$/.test(limitRaw)
        || (latestRaw !== null && latestRaw !== '1')
        || (latestRaw === '1' && url.searchParams.has('offset'))) {
        return Response.json({ ok: false, error: 'INVALID_PAGE' }, { status: 400, headers });
      }
      const offset = Number(offsetRaw);
      const limit = Number(limitRaw);
      if (limit < 1 || limit > 20) {
        return Response.json({ ok: false, error: 'INVALID_PAGE_LIMIT' }, { status: 400, headers });
      }
      return Response.json({
        ok: true,
        contract: STUDIONET_CONTRACT_ADDRESS,
        ...(await readRounds(offset, limit, latestRaw === '1')),
      }, { headers });
    } catch (error) {
      return Response.json({
        ok: false,
        error: requestedId ? 'ROUND_NOT_FOUND' : 'STUDIONET_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'The round data could not be read.',
      }, { status: requestedId ? 404 : 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
  },
};

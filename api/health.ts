import {
  DEPLOYMENT_TRANSACTION,
  GRANTARENA_VERSION,
  STUDIONET_CHAIN_ID,
  STUDIONET_CONTRACT_ADDRESS,
} from '../src/lib/public-config.js';
import { readContractInfo } from '../src/server/genlayer-read.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') {
      return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
    }
    try {
      const contract = await readContractInfo();
      return Response.json({
        ok: true,
        service: 'GrantArena API',
        apiVersion: GRANTARENA_VERSION,
        network: { name: 'GenLayer StudioNet', chainId: STUDIONET_CHAIN_ID },
        contract: {
          address: STUDIONET_CONTRACT_ADDRESS,
          deploymentTransaction: DEPLOYMENT_TRANSACTION,
          ...contract,
        },
        capabilities: {
          rounds: '/api/rounds?limit=20',
          proposals: '/api/proposals?round=1',
          deterministicPreview: '/api/preview',
          openapi: '/api/openapi',
          consensusWrites: 'Signed directly by a user or agent wallet on GenLayer StudioNet',
        },
      }, { headers });
    } catch (error) {
      return Response.json({
        ok: false,
        error: 'STUDIONET_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Unable to read the deployed contract.',
      }, { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
  },
};

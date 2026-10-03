import { GRANTARENA_VERSION } from '../src/lib/public-config.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=300, s-maxage=3600',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  fetch(request: Request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') {
      return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
    }
    const origin = new URL(request.url).origin;
    return Response.json({
      openapi: '3.1.0',
      info: {
        title: 'GrantArena API',
        version: GRANTARENA_VERSION,
        description: 'Public, keyless reads and deterministic proposal previews for the GrantArena GenLayer protocol. Consensus writes must be signed by a wallet.',
      },
      servers: [{ url: origin }],
      paths: {
        '/api/health': {
          get: { summary: 'Read service and deployed-contract health', responses: { 200: { description: 'Healthy' } } },
        },
        '/api/rounds': {
          get: {
            summary: 'List rounds or read one round',
            parameters: [
              { name: 'id', in: 'query', schema: { type: 'string', pattern: '^[1-9]\\d*$' } },
              { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
              { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20, default: 20 } },
              { name: 'latest', in: 'query', description: 'Use 1 for the newest page; omit offset when set.', schema: { type: 'string', enum: ['1'] } },
            ],
            responses: { 200: { description: 'Finalized round data' }, 404: { description: 'Round not found' } },
          },
        },
        '/api/proposals': {
          get: {
            summary: 'Read one proposal or every proposal in a round',
            parameters: [
              { name: 'id', in: 'query', schema: { type: 'string', pattern: '^[1-9]\\d*$' } },
              { name: 'round', in: 'query', schema: { type: 'string', pattern: '^[1-9]\\d*$' } },
            ],
            responses: { 200: { description: 'Finalized proposal data' }, 404: { description: 'Proposal data not found' } },
          },
        },
        '/api/preview': {
          post: {
            summary: 'Check criterion shape and deterministic distinct-word score caps',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PreviewRequest' } } },
            },
            responses: { 200: { description: 'Completeness preview' }, 400: { description: 'Invalid request' } },
          },
        },
      },
      components: {
        schemas: {
          Criterion: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label', 'description', 'weight'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              description: { type: 'string' },
              weight: { type: 'integer', minimum: 5, maximum: 80 },
            },
          },
          PreviewRequest: {
            type: 'object',
            additionalProperties: false,
            required: ['criteria', 'answers'],
            properties: {
              criteria: { type: 'array', minItems: 2, maxItems: 6, items: { $ref: '#/components/schemas/Criterion' } },
              answers: { type: 'object', additionalProperties: { type: 'string', maxLength: 1800 } },
            },
          },
        },
      },
    }, { headers });
  },
};

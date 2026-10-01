import { previewProposal } from '../src/lib/preview.js';
import type { Criterion } from '../src/types.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const MAX_BODY_BYTES = 32_768;

class BodyTooLarge extends Error {}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('A JSON request body is required.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLarge('Request body exceeds 32 KB.');
    }
    parts.push(decoder.decode(chunk.value, { stream: true }));
  }
  parts.push(decoder.decode());
  return JSON.parse(parts.join('')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBody(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.criteria) || !isRecord(value.answers)) {
    throw new Error('Body must contain criteria and answers.');
  }
  const criteria: Criterion[] = value.criteria.map((item) => {
    if (!isRecord(item)) throw new Error('Each criterion must be an object.');
    if (typeof item.id !== 'string' || typeof item.label !== 'string'
      || typeof item.description !== 'string' || typeof item.weight !== 'number') {
      throw new Error('Each criterion requires id, label, description, and numeric weight.');
    }
    return { id: item.id, label: item.label, description: item.description, weight: item.weight };
  });
  const answers = Object.fromEntries(Object.entries(value.answers).map(([key, answer]) => {
    if (typeof answer !== 'string') throw new Error(`Answer ${key} must be text.`);
    return [key, answer];
  }));
  return { criteria, answers };
}

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') {
      return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
    }
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
      return Response.json({ ok: false, error: 'BODY_TOO_LARGE' }, { status: 413, headers });
    }
    try {
      const input = parseBody(await readBoundedJson(request));
      return Response.json({ ok: true, preview: previewProposal(input) }, { headers });
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        return Response.json({ ok: false, error: 'BODY_TOO_LARGE' }, { status: 413, headers });
      }
      return Response.json({
        ok: false,
        error: 'INVALID_PREVIEW_INPUT',
        message: error instanceof Error ? error.message : 'Invalid request.',
      }, { status: 400, headers });
    }
  },
};

import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { getAddress } from 'viem';
import { parseContractInfo, parseProposal, parseRound } from '../lib/records.js';
import {
  STUDIONET_CONTRACT_ADDRESS,
  STUDIONET_RPC_URL,
} from '../lib/public-config.js';

const chain = {
  ...studionet,
  rpcUrls: { default: { http: [STUDIONET_RPC_URL] } },
} as const;

const client = createClient({ chain });
const address = getAddress(STUDIONET_CONTRACT_ADDRESS);
const latestFinal = TransactionHashVariant.LATEST_FINAL;

export async function readContractInfo() {
  return parseContractInfo(await client.readContract({
    address,
    args: [],
    functionName: 'get_contract_info',
    transactionHashVariant: latestFinal,
  }));
}

export async function readRound(roundId: bigint) {
  return parseRound(await client.readContract({
    address,
    args: [roundId],
    functionName: 'get_round',
    transactionHashVariant: latestFinal,
  }));
}

export async function readProposal(proposalId: bigint) {
  return parseProposal(await client.readContract({
    address,
    args: [proposalId],
    functionName: 'get_proposal',
    transactionHashVariant: latestFinal,
  }));
}

export async function readRounds(offset = 0, limit = 20, latest = false) {
  const info = await readContractInfo();
  const total = Number(info.roundCount);
  const start = latest
    ? Math.max(0, total - Math.max(1, Math.min(20, limit)))
    : Math.min(total, Math.max(0, offset));
  const stop = Math.min(total, start + Math.max(1, Math.min(20, limit)));
  const ids = Array.from({ length: stop - start }, (_, index) => BigInt(start + index + 1));
  const rounds = await Promise.all(ids.map(readRound));
  return { total: info.roundCount, offset: start, limit, rounds };
}

export async function readRoundProposals(roundId: bigint) {
  const round = await readRound(roundId);
  const proposals = await Promise.all(round.proposalIds.map((id) => readProposal(BigInt(id))));
  return { round, proposals };
}

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

const RPC_URL = 'https://studio.genlayer.com/api';
const REQUIRED_TRANSACTIONS = [
  ['createRound', 'creatorAddress'],
  ['submitProposal', 'winnerAddress'],
  ['contestProposal', 'winnerAddress'],
  ['finalizeRound', 'creatorAddress'],
  ['winnerWithdraw', 'winnerAddress'],
  ['creatorRemainderWithdraw', 'creatorAddress'],
];

function requireTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function sameAddress(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.toLowerCase() === right.toLowerCase();
}

function decimal(value, label) {
  requireTrue(typeof value === 'bigint' || typeof value === 'number' || /^\d+$/.test(String(value)), `Invalid ${label}.`);
  return BigInt(value);
}

/** Independently re-read StudioNet, rather than trusting assertions in the JSON report. */
export async function verifyAwardEvidence(evidence, chain) {
  const contractAddress = evidence.contractAddress;
  requireTrue(/^0x[0-9a-fA-F]{40}$/.test(contractAddress), 'Invalid contract address.');
  requireTrue(Number.isSafeInteger(evidence.roundId) && evidence.roundId > 0, 'Invalid round ID.');
  requireTrue(Number.isSafeInteger(evidence.proposalId) && evidence.proposalId > 0, 'Invalid proposal ID.');
  const pool = decimal(evidence.poolAtto, 'pool amount');
  const winnerAward = decimal(evidence.winnerAwardAtto, 'winner award');
  const creatorRemainder = decimal(evidence.creatorRemainderAtto, 'creator remainder');
  requireTrue(pool > 0n && winnerAward > 0n && pool === winnerAward + creatorRemainder, 'Award accounting in report does not balance.');

  const verifiedTransactions = {};
  for (const [label, senderField] of REQUIRED_TRANSACTIONS) {
    const hash = evidence.transactions?.[label];
    requireTrue(/^0x[0-9a-fA-F]{64}$/.test(hash || ''), `Missing ${label} transaction hash.`);
    const transaction = await chain.getTransaction(hash);
    requireTrue(transaction.statusName === 'FINALIZED', `${label} is not finalized.`);
    requireTrue(transaction.consensus_data?.leader_receipt?.[0]?.execution_result === 'SUCCESS', `${label} did not execute successfully.`);
    requireTrue(sameAddress(transaction.sender, evidence[senderField]), `${label} sender does not match.`);
    requireTrue(sameAddress(transaction.recipient, contractAddress), `${label} contract does not match.`);
    verifiedTransactions[label] = hash;
    if (label === 'createRound') {
      requireTrue(decimal(transaction.value, 'deposit') === pool, 'The on-chain round deposit does not match.');
    }
    if (label === 'winnerWithdraw' || label === 'creatorRemainderWithdraw') {
      const amount = label === 'winnerWithdraw' ? winnerAward : creatorRemainder;
      const recipient = evidence[senderField];
      const sends = transaction.consensus_data.leader_receipt[0].pending_transactions || [];
      requireTrue(sends.some((send) => send.is_eth_send === true
        && sameAddress(send.address, recipient)
        && decimal(send.value, `${label} transfer`) === amount), `${label} has no matching transfer instruction.`);
    }
  }

  const [info, round, proposal, winnerBalance] = await Promise.all([
    chain.readContract(contractAddress, 'get_contract_info', []),
    chain.readContract(contractAddress, 'get_round', [BigInt(evidence.roundId)]),
    chain.readContract(contractAddress, 'get_proposal', [BigInt(evidence.proposalId)]),
    chain.getBalance(evidence.winnerAddress),
  ]);
  requireTrue(info.version === 'grantarena/v1', 'Contract version differs from the award report.');
  requireTrue(round.status === 'FINALIZED', 'The round is not finalized.');
  requireTrue(sameAddress(round.creator, evidence.creatorAddress), 'Round creator differs.');
  requireTrue(decimal(round.pool_atto, 'on-chain pool') === pool, 'On-chain pool differs.');
  requireTrue(decimal(round.allocated_atto, 'on-chain allocation') === winnerAward, 'On-chain allocation differs.');
  requireTrue(decimal(round.returned_atto, 'on-chain remainder') === creatorRemainder, 'On-chain remainder differs.');
  requireTrue(round.winner_ids.map(Number).includes(evidence.proposalId), 'Proposal is not a winner.');
  requireTrue(Number(proposal.round_id) === evidence.roundId, 'Proposal belongs to a different round.');
  requireTrue(sameAddress(proposal.proposer, evidence.winnerAddress), 'Proposal owner differs.');
  requireTrue(proposal.status === 'FUNDED', 'Proposal is not marked funded.');
  requireTrue(decimal(proposal.award_atto, 'on-chain award') === winnerAward, 'On-chain award differs.');
  requireTrue(Boolean(proposal.contest_used) === Boolean(evidence.contestUsed), 'Contest status differs.');
  requireTrue(decimal(info.total_escrow_atto, 'escrow') + decimal(info.total_claimable_atto, 'claimable')
    === decimal(info.total_liability_atto, 'liability'), 'Current contract accounting invariant fails.');
  requireTrue(winnerBalance >= winnerAward, 'Winner currently holds less than the reported award; current balance cannot corroborate credit.');

  return {
    verifiedAt: new Date().toISOString(),
    network: 'GenLayer StudioNet',
    contractAddress,
    roundId: evidence.roundId,
    proposalId: evidence.proposalId,
    onChainRoundStatus: round.status,
    onChainProposalStatus: proposal.status,
    winnerAwardAtto: winnerAward.toString(),
    creatorRemainderAtto: creatorRemainder.toString(),
    winnerCurrentBalanceAtto: winnerBalance.toString(),
    transactionCount: Object.keys(verifiedTransactions).length,
    transactions: verifiedTransactions,
    caveat: 'The current balance may later change; applicant-provided proposal URLs and real-world claims are not authenticated by this check.',
  };
}

async function main() {
  const file = process.argv[2] || 'docs/STUDIONET-AWARD-EVIDENCE-2026-10-01.json';
  const evidence = JSON.parse(readFileSync(file, 'utf8'));
  const chain = {
    client: createClient({ chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } } }),
    async getTransaction(hash) {
      return this.client.getTransaction({ hash });
    },
    async readContract(address, functionName, args) {
      return this.client.readContract({ address, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
    },
    async getBalance(address) {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      });
      requireTrue(response.ok, `Balance RPC returned HTTP ${response.status}.`);
      const body = await response.json();
      requireTrue(typeof body.result === 'string' && /^0x[0-9a-fA-F]+$/.test(body.result), 'Balance RPC returned no balance.');
      return BigInt(body.result);
    },
  };
  console.log(JSON.stringify(await verifyAwardEvidence(evidence, chain), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

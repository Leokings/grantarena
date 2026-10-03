import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

const RPC_URL = 'https://studio.genlayer.com/api';
const evidencePath = process.argv[2] || 'docs/STUDIONET-ATTESTED-AWARD-EVIDENCE-2026-10-03.json';
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
const negativeEvidence = JSON.parse(readFileSync('docs/STUDIONET-UNATTESTED-EVIDENCE-2026-10-03.json', 'utf8'));
const client = createClient({ chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } } });

function assert(condition, reason) {
  if (!condition) throw new Error(reason);
}

function equalAddress(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  assert(response.ok, `${method} HTTP ${response.status}`);
  const body = await response.json();
  assert(!body.error && body.result !== undefined, `${method} returned an error`);
  return body.result;
}

async function readContract(functionName, args) {
  return client.readContract({
    address: evidence.contractAddress,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

async function checkTransaction(label, sender, report = evidence) {
  const hash = report.transactions[label];
  assert(/^0x[0-9a-fA-F]{64}$/.test(hash), `Invalid ${label} hash`);
  const tx = await client.getTransaction({ hash });
  assert(tx.statusName === 'FINALIZED', `${label} not finalized`);
  assert(tx.consensus_data?.leader_receipt?.[0]?.execution_result === 'SUCCESS', `${label} execution failed`);
  assert(equalAddress(tx.sender, sender), `${label} signer differs`);
  assert(equalAddress(tx.recipient, evidence.contractAddress), `${label} contract differs`);
  return tx;
}

async function main() {
  assert(evidence.schema === 'grantarena-studionet-attested-award/v2', 'Unexpected evidence schema');
  assert(/^0x[0-9a-fA-F]{40}$/.test(evidence.contractAddress), 'Invalid contract address');
  const pool = BigInt(evidence.poolAtto);
  const award = BigInt(evidence.awardAtto);
  const remainder = BigInt(evidence.creatorRemainderAtto);
  assert(pool > 0n && award > 0n && pool === award + remainder, 'Evidence arithmetic differs');

  const deploy = await client.getTransaction({ hash: evidence.deploymentTransaction });
  assert(deploy.statusName === 'FINALIZED' && deploy.consensus_data?.leader_receipt?.[0]?.execution_result === 'SUCCESS', 'Deployment not successful');
  assert(equalAddress(deploy.sender, evidence.creatorAddress), 'Deployment signer differs');
  const deployReceipt = await rpc('eth_getTransactionReceipt', [evidence.deploymentTransaction]);
  assert(deployReceipt.status === '0x1'
    && equalAddress(deployReceipt.contractAddress || deployReceipt.to, evidence.contractAddress), 'Deployment receipt has another contract address');

  const source = readFileSync('contracts/grant_arena.py');
  const deployedSource = Buffer.from(await rpc('gen_getContractCode', [evidence.contractAddress]), 'base64');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  assert(sourceHash === evidence.sourceSha256 && source.equals(deployedSource), 'Deployed source is not the audited local source');

  const created = await checkTransaction('createRound', evidence.creatorAddress);
  assert(BigInt(created.value) === pool, 'On-chain round deposit differs');
  await checkTransaction('submitProposal', evidence.winnerAddress);
  await checkTransaction('attestProposal', evidence.reviewerAddress);
  await checkTransaction('finalizeRound', evidence.creatorAddress);
  const withdrawn = await checkTransaction('winnerWithdraw', evidence.winnerAddress);
  const transfer = withdrawn.consensus_data.leader_receipt[0].pending_transactions || [];
  assert(transfer.some((item) => item.is_eth_send === true
    && equalAddress(item.address, evidence.winnerAddress)
    && BigInt(item.value) === award), 'Withdrawal receipt has no matching external transfer instruction');

  const [info, round, proposal, ownerClaimable] = await Promise.all([
    readContract('get_contract_info', []),
    readContract('get_round', [BigInt(evidence.roundId)]),
    readContract('get_proposal', [BigInt(evidence.proposalId)]),
    readContract('get_claimable', [evidence.creatorAddress]),
  ]);
  assert(info.version === 'grantarena/v2', 'Contract version differs');
  assert(round.status === 'FINALIZED' && round.winner_ids.includes(evidence.proposalId), 'Round winner differs');
  assert(equalAddress(round.creator, evidence.creatorAddress), 'Round creator differs');
  assert(equalAddress(round.reviewer, evidence.reviewerAddress), 'Round reviewer differs');
  assert(BigInt(round.pool_atto) === pool && BigInt(round.allocated_atto) === award && BigInt(round.returned_atto) === remainder, 'Round amounts differ');
  assert(proposal.status === 'FUNDED' && BigInt(proposal.award_atto) === award, 'Proposal award differs');
  assert(equalAddress(proposal.proposer, evidence.winnerAddress), 'Proposal owner differs');
  assert(proposal.evidence_digest === evidence.proposalDigest && proposal.attested_digest === evidence.proposalDigest, 'Attested proposal digest differs');
  assert(equalAddress(proposal.attested_by, evidence.reviewerAddress) && BigInt(proposal.attested_at) > 0n, 'Reviewer attestation differs');
  assert(BigInt(ownerClaimable) >= remainder, 'Creator remainder is not claimable');
  assert(BigInt(info.total_escrow_atto) + BigInt(info.total_claimable_atto) === BigInt(info.total_liability_atto), 'Contract accounting invariant fails');

  const currentBalance = BigInt(await rpc('eth_getBalance', [evidence.winnerAddress, 'latest']));
  assert(currentBalance >= award, 'Current winner balance cannot corroborate receipt; it may have been spent');

  assert(negativeEvidence.schema === 'grantarena-studionet-unattested-award/v2'
    && equalAddress(negativeEvidence.contractAddress, evidence.contractAddress), 'Negative canary identity differs');
  const unreviewedPool = BigInt(negativeEvidence.poolAtto);
  const unreviewedCreate = await checkTransaction('createRound', negativeEvidence.creatorAddress, negativeEvidence);
  assert(BigInt(unreviewedCreate.value) === unreviewedPool, 'Unreviewed round deposit differs');
  await checkTransaction('submitProposal', negativeEvidence.applicantAddress, negativeEvidence);
  await checkTransaction('finalizeRound', negativeEvidence.creatorAddress, negativeEvidence);
  const [unreviewedRound, unreviewedProposal, applicantClaimable] = await Promise.all([
    readContract('get_round', [BigInt(negativeEvidence.roundId)]),
    readContract('get_proposal', [BigInt(negativeEvidence.proposalId)]),
    readContract('get_claimable', [negativeEvidence.applicantAddress]),
  ]);
  assert(unreviewedRound.status === 'FINALIZED' && unreviewedRound.winner_ids.length === 0, 'Unreviewed round unexpectedly selected a winner');
  assert(BigInt(unreviewedRound.allocated_atto) === 0n && BigInt(unreviewedRound.returned_atto) === unreviewedPool, 'Unreviewed pool was not returned');
  assert(BigInt(ownerClaimable) >= remainder + unreviewedPool, 'Unreviewed pool is not claimable by the creator');
  assert(unreviewedProposal.status === 'QUALIFIED' && Number(unreviewedProposal.weighted_score) === negativeEvidence.score, 'Negative canary was not qualified');
  assert(BigInt(unreviewedProposal.attested_at) === 0n && BigInt(unreviewedProposal.award_atto) === 0n, 'Unreviewed applicant received an award');
  assert(BigInt(applicantClaimable) === 0n, 'Unreviewed applicant has claimable credit');
  console.log(JSON.stringify({
    ok: true,
    verifiedAt: new Date().toISOString(),
    network: evidence.network,
    contractAddress: evidence.contractAddress,
    sourceSha256: sourceHash,
    roundId: evidence.roundId,
    proposalId: evidence.proposalId,
    reviewerAttestation: true,
    unreviewedQualifiedProposalPaid: false,
    winnerAwardAtto: award.toString(),
    winnerCurrentBalanceAtto: currentBalance.toString(),
    finalizedSuccessfulTransactions: 9,
    caveat: 'This verifies the test-GEN flow and reviewer signature, not reviewer independence or the truth of applicant claims.',
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

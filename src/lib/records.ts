import type { ContractInfo, Criterion, ProposalRecord, RoundRecord } from '../types';

export function recordFrom(value: unknown, label: string): Record<string, unknown> {
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`GenLayer returned an invalid ${label}.`);
}

export function arrayFrom(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`GenLayer returned an invalid ${label}.`);
  return value;
}

export function stringFrom(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`GenLayer returned an invalid ${label}.`);
  return value;
}

export function decimalFrom(value: unknown, label: string): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  throw new Error(`GenLayer returned an invalid ${label}.`);
}

export function numberFrom(value: unknown, label: string): number {
  const parsed = Number(decimalFrom(value, label));
  if (!Number.isSafeInteger(parsed)) throw new Error(`GenLayer returned an unsafe ${label}.`);
  return parsed;
}

export function booleanFrom(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`GenLayer returned an invalid ${label}.`);
  return value;
}

function stringsFrom(value: unknown, label: string): string[] {
  return arrayFrom(value, label).map((item, index) => stringFrom(item, `${label}[${index}]`));
}

function decimalsFrom(value: unknown, label: string): string[] {
  return arrayFrom(value, label).map((item, index) => decimalFrom(item, `${label}[${index}]`));
}

function numbersFrom(value: unknown, label: string): number[] {
  return arrayFrom(value, label).map((item, index) => numberFrom(item, `${label}[${index}]`));
}

function criteriaFrom(value: unknown): Criterion[] {
  return arrayFrom(value, 'criteria').map((item, index) => {
    const criterion = recordFrom(item, `criterion ${index + 1}`);
    return {
      id: stringFrom(criterion.id, 'criterion ID'),
      label: stringFrom(criterion.label, 'criterion label'),
      description: stringFrom(criterion.description, 'criterion description'),
      weight: numberFrom(criterion.weight, 'criterion weight'),
    };
  });
}

function answersFrom(value: unknown): Record<string, string> {
  const record = recordFrom(value, 'proposal answers');
  return Object.fromEntries(
    Object.entries(record).map(([key, answer]) => [key, stringFrom(answer, `answer ${key}`)]),
  );
}

export function parseContractInfo(value: unknown): ContractInfo {
  const record = recordFrom(value, 'contract information');
  return {
    schema: stringFrom(record.schema, 'contract schema'),
    version: stringFrom(record.version, 'contract version'),
    deployer: String(record.deployer ?? ''),
    roundCount: decimalFrom(record.round_count, 'round count'),
    proposalCount: decimalFrom(record.proposal_count, 'proposal count'),
    withdrawalCount: decimalFrom(record.withdrawal_count, 'withdrawal count'),
    totalEscrowAtto: decimalFrom(record.total_escrow_atto, 'escrow'),
    totalClaimableAtto: decimalFrom(record.total_claimable_atto, 'claimable total'),
    totalLiabilityAtto: decimalFrom(record.total_liability_atto, 'liability'),
    totalWithdrawnAtto: decimalFrom(record.total_withdrawn_atto, 'withdrawn total'),
  };
}

export function parseRound(value: unknown): RoundRecord {
  const record = recordFrom(value, 'round');
  const status = stringFrom(record.status, 'round status');
  if (!['OPEN', 'FINALIZED', 'CANCELLED'].includes(status)) {
    throw new Error('GenLayer returned an unknown round status.');
  }
  return {
    schema: stringFrom(record.schema, 'round schema'),
    roundId: decimalFrom(record.round_id, 'round ID'),
    roundKey: stringFrom(record.round_key, 'round key'),
    creator: String(record.creator ?? ''),
    reviewer: stringFrom(record.reviewer, 'reviewer'),
    title: stringFrom(record.title, 'round title'),
    mission: stringFrom(record.mission, 'round mission'),
    submissionDeadline: decimalFrom(record.submission_deadline, 'submission deadline'),
    appealDeadline: decimalFrom(record.appeal_deadline, 'appeal deadline'),
    winnerCount: numberFrom(record.winner_count, 'winner count'),
    minimumScore: numberFrom(record.minimum_score, 'minimum score'),
    proposalBondAtto: decimalFrom(record.proposal_bond_atto, 'proposal bond'),
    criteria: criteriaFrom(record.criteria),
    payoutBps: numbersFrom(record.payout_bps, 'payout shares'),
    poolAtto: decimalFrom(record.pool_atto, 'round pool'),
    proposalIds: decimalsFrom(record.proposal_ids, 'proposal IDs'),
    proposalCount: numberFrom(record.proposal_count, 'proposal count'),
    qualifiedCount: numberFrom(record.qualified_count, 'qualified count'),
    winnerIds: decimalsFrom(record.winner_ids, 'winner IDs'),
    status: status as RoundRecord['status'],
    createdAt: decimalFrom(record.created_at, 'created time'),
    finalizedAt: decimalFrom(record.finalized_at, 'finalized time'),
    ...(record.allocated_atto === undefined ? {} : { allocatedAtto: decimalFrom(record.allocated_atto, 'allocated') }),
    ...(record.returned_atto === undefined ? {} : { returnedAtto: decimalFrom(record.returned_atto, 'returned') }),
  };
}

export function parseProposal(value: unknown): ProposalRecord {
  const record = recordFrom(value, 'proposal');
  const status = stringFrom(record.status, 'proposal status');
  if (!['QUALIFIED', 'REJECTED', 'FUNDED', 'SELECTED'].includes(status)) {
    throw new Error('GenLayer returned an unknown proposal status.');
  }
  return {
    schema: stringFrom(record.schema, 'proposal schema'),
    proposalId: decimalFrom(record.proposal_id, 'proposal ID'),
    roundId: decimalFrom(record.round_id, 'round ID'),
    proposalKey: stringFrom(record.proposal_key, 'proposal key'),
    proposer: String(record.proposer ?? ''),
    title: stringFrom(record.title, 'proposal title'),
    summary: stringFrom(record.summary, 'proposal summary'),
    requestedAtto: decimalFrom(record.requested_atto, 'requested amount'),
    answers: answersFrom(record.answers),
    evidenceUrls: stringsFrom(record.evidence_urls, 'evidence URLs'),
    grades: stringsFrom(record.grades, 'grades'),
    criterionScores: numbersFrom(record.criterion_scores, 'criterion scores'),
    weightedScore: numberFrom(record.weighted_score, 'weighted score'),
    evaluationSummary: stringFrom(record.evaluation_summary, 'evaluation summary'),
    status: status as ProposalRecord['status'],
    bondAtto: decimalFrom(record.bond_atto, 'proposal bond'),
    contestUsed: booleanFrom(record.contest_used, 'contest flag'),
    contestAddendum: stringFrom(record.contest_addendum, 'contest addendum'),
    evidenceDigest: stringFrom(record.evidence_digest, 'evidence digest'),
    attestedBy: stringFrom(record.attested_by, 'attester'),
    attestedDigest: stringFrom(record.attested_digest, 'attested digest'),
    attestedAt: decimalFrom(record.attested_at, 'attestation time'),
    attestationNote: stringFrom(record.attestation_note, 'attestation note'),
    rank: numberFrom(record.rank, 'rank'),
    awardAtto: decimalFrom(record.award_atto, 'award'),
    submittedAt: decimalFrom(record.submitted_at, 'submitted time'),
  };
}

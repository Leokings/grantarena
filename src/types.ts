export type Criterion = {
  id: string;
  label: string;
  description: string;
  weight: number;
};

export type RoundRecord = {
  schema: string;
  roundId: string;
  roundKey: string;
  creator: string;
  reviewer: string;
  title: string;
  mission: string;
  submissionDeadline: string;
  appealDeadline: string;
  winnerCount: number;
  minimumScore: number;
  proposalBondAtto: string;
  criteria: Criterion[];
  payoutBps: number[];
  poolAtto: string;
  proposalIds: string[];
  proposalCount: number;
  qualifiedCount: number;
  winnerIds: string[];
  status: 'OPEN' | 'FINALIZED' | 'CANCELLED';
  createdAt: string;
  finalizedAt: string;
  allocatedAtto?: string;
  returnedAtto?: string;
};

export type ProposalRecord = {
  schema: string;
  proposalId: string;
  roundId: string;
  proposalKey: string;
  proposer: string;
  title: string;
  summary: string;
  requestedAtto: string;
  answers: Record<string, string>;
  evidenceUrls: string[];
  grades: string[];
  criterionScores: number[];
  weightedScore: number;
  evaluationSummary: string;
  status: 'QUALIFIED' | 'REJECTED' | 'FUNDED' | 'SELECTED';
  bondAtto: string;
  contestUsed: boolean;
  contestAddendum: string;
  evidenceDigest: string;
  attestedBy: string;
  attestedDigest: string;
  attestedAt: string;
  attestationNote: string;
  rank: number;
  awardAtto: string;
  submittedAt: string;
};

export type ContractInfo = {
  schema: string;
  version: string;
  deployer: string;
  roundCount: string;
  proposalCount: string;
  withdrawalCount: string;
  totalEscrowAtto: string;
  totalClaimableAtto: string;
  totalLiabilityAtto: string;
  totalWithdrawnAtto: string;
};

export type CreateRoundInput = {
  roundKey: string;
  title: string;
  mission: string;
  submissionDeadline: number;
  appealSeconds: number;
  winnerCount: number;
  minimumScore: number;
  proposalBondAtto: bigint;
  reviewer: string;
  criteria: Criterion[];
  payoutBps: number[];
  poolAtto: bigint;
};

export type SubmitProposalInput = {
  roundId: bigint;
  proposalKey: string;
  title: string;
  summary: string;
  requestedAtto: bigint;
  answers: Record<string, string>;
  evidenceUrls: string[];
  bondAtto: bigint;
};

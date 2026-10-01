type ReceiptLike = {
  statusName?: unknown;
  txExecutionResultName?: unknown;
  sender?: unknown;
  recipient?: unknown;
  consensus_data?: {
    leader_receipt?: Array<{ execution_result?: unknown }>;
  };
};

type PollOptions = {
  attempts?: number;
  intervalMs?: number;
  maxConsecutiveReadErrors?: number;
};

/** StudioNet's SDK omits txExecutionResultName; inspect the leader receipt. */
export function assertFinalizedExecution(
  transaction: ReceiptLike,
  expectedSender: string,
  expectedRecipient: string,
): void {
  if (transaction.statusName !== 'FINALIZED') {
    throw new Error('The GenLayer transaction did not reach finality.');
  }
  if (typeof transaction.sender !== 'string'
    || transaction.sender.toLowerCase() !== expectedSender.toLowerCase()) {
    throw new Error('The finalized transaction was signed by a different wallet.');
  }
  if (typeof transaction.recipient !== 'string'
    || transaction.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
    throw new Error('The finalized transaction targeted a different contract.');
  }
  const leaderResult = transaction.consensus_data?.leader_receipt?.[0]?.execution_result;
  if (leaderResult !== 'SUCCESS') {
    throw new Error('The finalized GenLayer transaction rolled back or has no verified success receipt.');
  }
  if (transaction.txExecutionResultName !== undefined
    && transaction.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(`The finalized GenLayer transaction failed: ${transaction.txExecutionResultName}.`);
  }
}

/** Keep a transient hosted RPC failure from becoming a false transaction failure. */
export async function waitForVerifiedFinality(
  getTransaction: () => Promise<ReceiptLike>,
  expectedSender: string,
  expectedRecipient: string,
  options: PollOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 1_200;
  const intervalMs = options.intervalMs ?? 3_000;
  const maxReadErrors = options.maxConsecutiveReadErrors ?? 20;
  let readErrors = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let transaction: ReceiptLike | null = null;
    try {
      transaction = await getTransaction();
      readErrors = 0;
    } catch {
      readErrors += 1;
      if (readErrors >= maxReadErrors) {
        throw new Error('StudioNet is unavailable. This transaction may still finalize; check its link before retrying.');
      }
    }
    if (transaction?.statusName === 'FINALIZED') {
      assertFinalizedExecution(transaction, expectedSender, expectedRecipient);
      return;
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error('Finality was not confirmed in time. Check the transaction link before retrying.');
}

import { describe, expect, it } from 'vitest';
import { assertFinalizedExecution, waitForVerifiedFinality } from './finality';

const sender = '0xAE2e0Fa591E33Ce6E78A1da706750eCDE5078a26';
const recipient = '0x9459d5b6e3da734255C5ae6039Ed104d9D74F3B3';

describe('StudioNet finalized execution verification', () => {
  it('accepts the successful live StudioNet receipt shape', () => {
    expect(() => assertFinalizedExecution({
      statusName: 'FINALIZED',
      sender,
      recipient,
      consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
    }, sender, recipient)).not.toThrow();
  });

  it('rejects a finalized rollback even though the SDK omits txExecutionResultName', () => {
    expect(() => assertFinalizedExecution({
      statusName: 'FINALIZED',
      sender,
      recipient,
      consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }] },
    }, sender, recipient)).toThrow(/rolled back/);
  });

  it('rejects missing execution evidence and wallet/contract mismatches', () => {
    const receipt = {
      statusName: 'FINALIZED', sender, recipient,
      consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
    };
    expect(() => assertFinalizedExecution({ statusName: 'FINALIZED', sender, recipient }, sender, recipient)).toThrow(/no verified success/);
    expect(() => assertFinalizedExecution(receipt, '0x0000000000000000000000000000000000000001', recipient)).toThrow(/different wallet/);
    expect(() => assertFinalizedExecution(receipt, sender, '0x0000000000000000000000000000000000000001')).toThrow(/different contract/);
  });

  it('recovers after a transient RPC failure and confirms the successful receipt', async () => {
    const states = [
      () => { throw new Error('HTTP 502'); },
      () => ({ statusName: 'ACCEPTED' }),
      () => ({
        statusName: 'FINALIZED', sender, recipient,
        consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
      }),
    ];
    await expect(waitForVerifiedFinality(
      async () => states.shift()!(), sender, recipient,
      { attempts: 3, intervalMs: 0, maxConsecutiveReadErrors: 2 },
    )).resolves.toBeUndefined();
  });

  it('does not swallow a finalized rollback or indefinitely retry an unavailable RPC', async () => {
    await expect(waitForVerifiedFinality(async () => ({
      statusName: 'FINALIZED', sender, recipient,
      consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }] },
    }), sender, recipient, { attempts: 3, intervalMs: 0 })).rejects.toThrow(/rolled back/);
    await expect(waitForVerifiedFinality(async () => { throw new Error('HTTP 502'); },
      sender, recipient, { attempts: 2, intervalMs: 0, maxConsecutiveReadErrors: 2 })).rejects.toThrow(/may still finalize/);
  });
});

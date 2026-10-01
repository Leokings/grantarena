import { describe, expect, it } from 'vitest';
import { errorText, walletConnectionErrorText } from './App';

describe('browser and wallet errors', () => {
  it('shows an Error instance message', () => {
    expect(errorText(new Error('EIP-1193 wallet is unavailable'))).toBe('EIP-1193 wallet is unavailable');
  });

  it('shows messages from extension error objects', () => {
    expect(errorText({ code: 4001, message: 'User rejected the request.' })).toBe('User rejected the request.');
  });

  it('offers actionable guidance for an opaque provider failure', () => {
    expect(walletConnectionErrorText({ code: -32000 })).toMatch(/Unlock your wallet/);
  });
});

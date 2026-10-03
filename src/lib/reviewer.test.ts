import { describe, expect, it } from 'vitest';
import { reviewerAddressError } from './reviewer';

describe('funded-round reviewer address', () => {
  it('rejects an empty or malformed address before wallet connection', () => {
    expect(reviewerAddressError('')).toMatch(/valid EVM wallet/);
    expect(reviewerAddressError('not-a-wallet')).toMatch(/valid EVM wallet/);
  });

  it('rejects the zero address, which can never sign an attestation', () => {
    expect(reviewerAddressError('0x0000000000000000000000000000000000000000'))
      .toMatch(/zero address cannot attest/);
  });

  it('accepts a normal wallet address', () => {
    expect(reviewerAddressError('0x1111111111111111111111111111111111111111')).toBeNull();
  });
});

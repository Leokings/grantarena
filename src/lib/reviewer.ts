import { isAddress } from 'viem';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function reviewerAddressError(value: string): string | null {
  if (!isAddress(value)) return 'Enter a valid EVM wallet address for the evidence reviewer.';
  if (value.toLowerCase() === ZERO_ADDRESS) {
    return 'Choose a reviewer wallet that someone controls; the zero address cannot attest.';
  }
  return null;
}

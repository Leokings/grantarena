export const GRANTARENA_VERSION = '2.0.0';
export const STUDIONET_CHAIN_ID = 61_999;
export const STUDIONET_RPC_URL = 'https://studio.genlayer.com/api';
export const STUDIONET_CONTRACT_ADDRESS = '0x1ce8DB3eD235dEdF7e2Ec9E4318EbdD99Ad43F6f';
export const DEPLOYMENT_TRANSACTION = '0x6b84ffe5624f811f559e69ff99a107ef45d1e581b48eccb6f18b45c82808e9b6';
export const EXPLORER_BASE_URL = 'https://explorer-studio.genlayer.com';

export function explorerTransaction(hash: string) {
  return `${EXPLORER_BASE_URL}/transactions/${hash}`;
}

export function explorerContract(address = STUDIONET_CONTRACT_ADDRESS) {
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

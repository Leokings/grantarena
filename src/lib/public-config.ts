export const GRANTARENA_VERSION = '1.0.0';
export const STUDIONET_CHAIN_ID = 61_999;
export const STUDIONET_RPC_URL = 'https://studio.genlayer.com/api';
export const STUDIONET_CONTRACT_ADDRESS = '0x9459d5b6e3da734255C5ae6039Ed104d9D74F3B3';
export const DEPLOYMENT_TRANSACTION = '0xb34fe17f803162072c96b1d34a45c0811a053d1e17f21ef0ff5e42cd1e2ae40f';
export const EXPLORER_BASE_URL = 'https://explorer-studio.genlayer.com';

export function explorerTransaction(hash: string) {
  return `${EXPLORER_BASE_URL}/transactions/${hash}`;
}

export function explorerContract(address = STUDIONET_CONTRACT_ADDRESS) {
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

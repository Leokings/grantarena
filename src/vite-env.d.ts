/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GENLAYER_RPC_URL?: string;
  readonly VITE_GENLAYER_CONTRACT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

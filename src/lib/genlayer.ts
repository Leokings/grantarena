import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import {
  TransactionHashVariant,
  type CalldataEncodable,
  type TransactionHash,
} from 'genlayer-js/types';
import { getAddress, isAddress } from 'viem';
import type {
  ContractInfo,
  CreateRoundInput,
  ProposalRecord,
  RoundRecord,
  SubmitProposalInput,
} from '../types';
import { decimalFrom, parseContractInfo, parseProposal, parseRound } from './records';
import { waitForVerifiedFinality } from './finality';
import {
  STUDIONET_CONTRACT_ADDRESS,
  STUDIONET_RPC_URL,
} from './public-config';

const configuredRpc = import.meta.env.VITE_GENLAYER_RPC_URL?.trim() || STUDIONET_RPC_URL;
const configuredAddress = import.meta.env.VITE_GENLAYER_CONTRACT_ADDRESS?.trim() || STUDIONET_CONTRACT_ADDRESS;
const chain = {
  ...studionet,
  rpcUrls: { default: { http: [configuredRpc] } },
} as const;
const contractAddress = getAddress(configuredAddress);
const readClient = createClient({ chain });
const latestFinal = TransactionHashVariant.LATEST_FINAL;

export class SubmittedTransactionError extends Error {
  constructor(public readonly hash: TransactionHash, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The submitted transaction could not be verified.');
  }
}

type ClientConfig = NonNullable<Parameters<typeof createClient>[0]>;
type WalletProvider = NonNullable<ClientConfig['provider']>;
type ProviderRequest = { method: string; params?: unknown[] };
type InjectedProvider = WalletProvider & {
  request(args: ProviderRequest): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

export type WalletOption = {
  id: string;
  name: string;
  provider: InjectedProvider;
};

type ProviderWindow = Window & {
  ethereum?: InjectedProvider & { providers?: InjectedProvider[] };
  okxwallet?: InjectedProvider;
  phantom?: { ethereum?: InjectedProvider };
  coinbaseWalletExtension?: InjectedProvider;
};

const announcedProviders = new Map<string, WalletOption>();
let listeningWindow: Window | null = null;
let selectedProvider: InjectedProvider | null = null;

export function clearSelectedWallet() {
  selectedProvider = null;
}

function isProvider(value: unknown): value is InjectedProvider {
  return Boolean(value && typeof value === 'object'
    && 'request' in value && typeof value.request === 'function');
}

function legacyName(provider: InjectedProvider, fallback: string) {
  const flags = provider as InjectedProvider & Record<string, unknown>;
  if (flags.isOkxWallet || flags.isOKExWallet) return 'OKX Wallet';
  if (flags.isRabby) return 'Rabby Wallet';
  if (flags.isCoinbaseWallet) return 'Coinbase Wallet';
  if (flags.isPhantom) return 'Phantom Wallet';
  if (flags.isMetaMask) return 'MetaMask';
  return fallback;
}

function listenForProviders() {
  if (listeningWindow === window || typeof window.addEventListener !== 'function') return;
  announcedProviders.clear();
  listeningWindow = window;
  // EIP-6963 requires keeping this listener for the lifetime of the page.
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = (event as CustomEvent).detail as {
      info?: { uuid?: unknown; name?: unknown };
      provider?: unknown;
    } | undefined;
    if (!detail || !isProvider(detail.provider)
      || typeof detail.info?.uuid !== 'string'
      || typeof detail.info.name !== 'string') return;
    const name = detail.info.name.trim().slice(0, 60);
    if (!name) return;
    announcedProviders.set(detail.info.uuid, {
      id: `eip6963:${detail.info.uuid}`,
      name,
      provider: detail.provider,
    });
  });
}

export async function discoverWallets(): Promise<WalletOption[]> {
  listenForProviders();
  if (typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    // Extensions normally re-announce synchronously, but allow a short delay.
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const options = [...announcedProviders.values()];
  const seen = new Set(options.map((option) => option.provider));
  const addLegacy = (candidate: unknown, fallback: string) => {
    if (!isProvider(candidate) || seen.has(candidate)) return;
    const name = legacyName(candidate, fallback);
    // Some extensions announce a provider and expose a separate proxy under a
    // legacy window key. Show one choice for the same named wallet.
    if (name !== 'Browser wallet' && options.some((option) => option.name.toLowerCase() === name.toLowerCase())) return;
    seen.add(candidate);
    options.push({
      id: `legacy:${options.length}`,
      name,
      provider: candidate,
    });
  };
  const injected = window as ProviderWindow;
  for (const provider of injected.ethereum?.providers ?? []) addLegacy(provider, 'Browser wallet');
  addLegacy(injected.okxwallet, 'OKX Wallet');
  addLegacy(injected.phantom?.ethereum, 'Phantom Wallet');
  addLegacy(injected.coinbaseWalletExtension, 'Coinbase Wallet');
  addLegacy(injected.ethereum, 'Browser wallet');
  return options;
}

function providerFromWindow() {
  const injected = window as ProviderWindow;
  const provider = [selectedProvider, injected.ethereum, injected.okxwallet]
    .find((candidate) => candidate && typeof candidate.request === 'function');
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('No compatible EVM wallet found in this browser. Open GrantArena in a browser with an EIP-1193 wallet.');
  }
  return provider;
}

async function ensureStudionet(provider: InjectedProvider) {
  const chainId = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? Number((error as { code?: unknown }).code)
      : 0;
    if (code !== 4_902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        blockExplorerUrls: chain.blockExplorers?.default ? [chain.blockExplorers.default.url] : undefined,
        chainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [configuredRpc],
      }],
    });
  }
}

function transactionHash(value: unknown): TransactionHash {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('GenLayer did not return a valid transaction hash.');
  }
  return value as TransactionHash;
}

async function walletClient(account: string) {
  const provider = providerFromWindow();
  await ensureStudionet(provider);
  return createClient({ account: getAddress(account), chain, provider });
}

async function waitForFinalized(hash: TransactionHash, account: string) {
  await waitForVerifiedFinality(
    () => readClient.getTransaction({ hash }),
    account,
    contractAddress,
  );
}

async function write(
  account: string,
  functionName: string,
  args: CalldataEncodable[],
  value: bigint,
  onSubmitted?: (hash: TransactionHash) => void,
) {
  const client = await walletClient(account);
  const hash = transactionHash(await client.writeContract({
    address: contractAddress,
    args,
    functionName,
    leaderOnly: false,
    value,
  }));
  onSubmitted?.(hash);
  try {
    await waitForFinalized(hash, account);
  } catch (error) {
    throw new SubmittedTransactionError(hash, error);
  }
  return hash;
}

export async function connectWallet(option?: WalletOption) {
  const provider = option?.provider ?? providerFromWindow();
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !isAddress(accounts[0])) {
    throw new Error('The wallet did not expose a valid account.');
  }
  await ensureStudionet(provider);
  if (option) selectedProvider = provider;
  return getAddress(accounts[0]);
}

export function observeWallet(
  onAccountChange: (account: string) => void,
  onChainChange: (isStudionet: boolean) => void,
) {
  const provider = providerFromWindow();
  const accountsChanged = (value: unknown) => {
    const accounts = Array.isArray(value) ? value : [];
    const account = accounts[0];
    onAccountChange(typeof account === 'string' && isAddress(account) ? getAddress(account) : '');
  };
  const chainChanged = (value: unknown) => {
    const id = typeof value === 'string' ? Number(value) : NaN;
    onChainChange(id === chain.id);
  };
  provider.on?.('accountsChanged', accountsChanged);
  provider.on?.('chainChanged', chainChanged);
  return () => {
    provider.removeListener?.('accountsChanged', accountsChanged);
    provider.removeListener?.('chainChanged', chainChanged);
  };
}

export async function readInfo(): Promise<ContractInfo> {
  return parseContractInfo(await readClient.readContract({
    address: contractAddress,
    args: [],
    functionName: 'get_contract_info',
    transactionHashVariant: latestFinal,
  }));
}

export async function readRound(roundId: bigint): Promise<RoundRecord> {
  return parseRound(await readClient.readContract({
    address: contractAddress,
    args: [roundId],
    functionName: 'get_round',
    transactionHashVariant: latestFinal,
  }));
}

export async function readProposal(proposalId: bigint): Promise<ProposalRecord> {
  return parseProposal(await readClient.readContract({
    address: contractAddress,
    args: [proposalId],
    functionName: 'get_proposal',
    transactionHashVariant: latestFinal,
  }));
}

export async function readClaimable(account: string): Promise<string> {
  return decimalFrom(await readClient.readContract({
    address: contractAddress,
    args: [getAddress(account)],
    functionName: 'get_claimable',
    transactionHashVariant: latestFinal,
  }), 'claimable balance');
}

export async function createRound(
  account: string,
  input: CreateRoundInput,
  onSubmitted?: (hash: TransactionHash) => void,
) {
  return write(account, 'create_round', [
    input.roundKey,
    input.title,
    input.mission,
    BigInt(input.submissionDeadline),
    BigInt(input.appealSeconds),
    BigInt(input.winnerCount),
    BigInt(input.minimumScore),
    input.proposalBondAtto,
    JSON.stringify(input.criteria),
    JSON.stringify(input.payoutBps),
  ], input.poolAtto, onSubmitted);
}

export async function submitProposal(
  account: string,
  input: SubmitProposalInput,
  onSubmitted?: (hash: TransactionHash) => void,
) {
  return write(account, 'submit_proposal', [
    input.roundId,
    input.proposalKey,
    input.title,
    input.summary,
    input.requestedAtto,
    JSON.stringify(input.answers),
    JSON.stringify(input.evidenceUrls),
  ], input.bondAtto, onSubmitted);
}

export async function contestProposal(
  account: string,
  proposalId: bigint,
  addendum: string,
  onSubmitted?: (hash: TransactionHash) => void,
) {
  return write(account, 'contest_proposal', [proposalId, addendum], 0n, onSubmitted);
}

export async function finalizeRound(
  account: string,
  roundId: bigint,
  onSubmitted?: (hash: TransactionHash) => void,
) {
  return write(account, 'finalize_round', [roundId], 0n, onSubmitted);
}

export async function withdraw(
  account: string,
  onSubmitted?: (hash: TransactionHash) => void,
) {
  return write(account, 'withdraw', [], 0n, onSubmitted);
}

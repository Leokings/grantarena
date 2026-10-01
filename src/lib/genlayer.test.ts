import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSelectedWallet, connectWallet, discoverWallets, observeWallet } from './genlayer';

const first = '0x1234567890abcdef1234567890abcdef12345678';
const second = '0x2222222222222222222222222222222222222222';

afterEach(() => {
  clearSelectedWallet();
  vi.unstubAllGlobals();
});

describe('wallet connection and changes', () => {
  it('reports a missing injected wallet clearly', async () => {
    vi.stubGlobal('window', {});
    await expect(connectWallet()).rejects.toThrow(/EIP-1193 wallet/);
  });

  it('requests an account and switches to StudioNet', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [first];
      if (method === 'wallet_switchEthereumChain') return null;
      throw new Error(`Unexpected method: ${method}`);
    });
    vi.stubGlobal('window', { ethereum: { request } });
    await expect(connectWallet()).resolves.toBe('0x1234567890AbcdEF1234567890aBcdef12345678');
    expect(request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xf22f' }] });
  });

  it('uses OKX Wallet when it is exposed without window.ethereum', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [first];
      if (method === 'wallet_switchEthereumChain') return null;
      throw new Error(`Unexpected method: ${method}`);
    });
    vi.stubGlobal('window', { okxwallet: { request, isOkxWallet: true } });
    await expect(connectWallet()).resolves.toBe('0x1234567890AbcdEF1234567890aBcdef12345678');
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xf22f' }] });
  });

  it('lets the user select OKX Wallet over another injected provider', async () => {
    const okxRequest = vi.fn(async ({ method }: { method: string }) =>
      method === 'eth_requestAccounts' ? [first] : null);
    const otherRequest = vi.fn(async () => { throw new Error('Wrong provider'); });
    vi.stubGlobal('window', {
      okxwallet: { request: okxRequest },
      ethereum: { request: otherRequest },
    });
    const wallets = await discoverWallets();
    expect(wallets.map((wallet) => wallet.name)).toContain('OKX Wallet');
    const okx = wallets.find((wallet) => wallet.name === 'OKX Wallet');
    await expect(connectWallet(okx)).resolves.toBe('0x1234567890AbcdEF1234567890aBcdef12345678');
    expect(otherRequest).not.toHaveBeenCalled();
  });

  it('discovers multiple EIP-6963 wallets alongside a legacy provider', async () => {
    const page = new EventTarget() as EventTarget & { ethereum?: unknown };
    const firstProvider = { request: vi.fn() };
    const secondProvider = { request: vi.fn() };
    const legacyProvider = { request: vi.fn() };
    page.ethereum = legacyProvider;
    page.addEventListener('eip6963:requestProvider', () => {
      page.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid: 'wallet-a', name: 'Wallet A' }, provider: firstProvider },
      }));
      page.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid: 'wallet-b', name: 'Wallet B' }, provider: secondProvider },
      }));
    });
    vi.stubGlobal('window', page);
    const wallets = await discoverWallets();
    expect(wallets.map((wallet) => wallet.name)).toEqual(['Wallet A', 'Wallet B', 'Browser wallet']);
  });

  it('does not duplicate an announced wallet with a legacy proxy', async () => {
    const page = new EventTarget() as EventTarget & { okxwallet?: unknown };
    const announced = { request: vi.fn() };
    page.okxwallet = { request: vi.fn(), isOkxWallet: true };
    page.addEventListener('eip6963:requestProvider', () => {
      page.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid: 'okx', name: 'OKX Wallet' }, provider: announced },
      }));
    });
    vi.stubGlobal('window', page);
    expect((await discoverWallets()).map((wallet) => wallet.name)).toEqual(['OKX Wallet']);
  });

  it('tracks account and chain changes and removes listeners', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const provider = {
      request: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
      removeListener: vi.fn((event: string) => listeners.delete(event)),
    };
    vi.stubGlobal('window', { ethereum: provider });
    const accounts = vi.fn();
    const chains = vi.fn();
    const stop = observeWallet(accounts, chains);
    listeners.get('accountsChanged')?.([second]);
    listeners.get('chainChanged')?.('0x1');
    listeners.get('accountsChanged')?.([]);
    expect(accounts).toHaveBeenNthCalledWith(1, second);
    expect(accounts).toHaveBeenNthCalledWith(2, '');
    expect(chains).toHaveBeenCalledWith(false);
    stop();
    expect(listeners.size).toBe(0);
  });
});

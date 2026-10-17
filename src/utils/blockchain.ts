import { CHAIN_BY_ID, type Chain } from './chains.js';

export interface ChainBalance {
  chainId: string;
  raw: bigint | number;
  formatted: number;
  usd: number;
  stableCoins?: StableCoinBalance[];
  error?: string;
}

export interface StableCoinBalance {
  symbol: string;
  raw: bigint | number;
  formatted: number;
  usd: number;
  error?: string;
}

interface BalanceResult {
  raw: bigint | number;
  formatted: number;
  stableCoins?: StableCoinBalance[];
}

/**
 * Fetch the native-token balance for a single chain.
 */
export async function fetchBalance(
  chain: Chain,
  address: string
): Promise<BalanceResult> {
  switch (chain.type) {
    case 'btc':
      return fetchBtcBalance(address);
    case 'evm':
      return fetchEvmBalances(chain, address);
    case 'sol':
      return fetchSolBalances(chain, address);
    default:
      throw new Error(`Unsupported chain type: ${chain.type}`);
  }
}

/**
 * Fetch BTC balance from Blockstream (satoshis).
 */
async function fetchBtcBalance(address: string): Promise<{ raw: number; formatted: number }> {
  const res = await fetch(`https://blockstream.info/api/address/${address}`);
  if (!res.ok) throw new Error(`Blockstream error ${res.status}`);
  const data = await res.json();
  const funded = data.chain_stats?.funded_txo_sum ?? 0;
  const spent = data.chain_stats?.spent_txo_sum ?? 0;
  const sats = funded - spent;
  return { raw: sats, formatted: sats / 1e8 };
}

/**
 * Fetch EVM native balance via standard JSON-RPC.
 */
async function fetchEvmBalances(
  chain: Chain,
  address: string
): Promise<BalanceResult> {
  const rpcUrls = chain.rpcUrls ?? (chain.rpcUrl ? [chain.rpcUrl] : []);
  if (rpcUrls.length === 0) throw new Error('No RPC configured');

  const tokens = chain.stableCoins ?? [];
  const paddedOwner = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const calls = [
    {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    },
    ...tokens
      .filter((token) => token.address)
      .map((token, index) => ({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: token.address, data: `0x70a08231${paddedOwner}` }, 'latest'],
        id: index + 2,
      })),
  ];

  const results = await evmRpcBatch(rpcUrls, calls, chain.name);
  const wei = BigInt(results[0] ?? '0x0');
  const stableCoins = tokens.map((token, index) => {
    if (!token.address) return { symbol: token.symbol, raw: BigInt(0), formatted: 0, usd: 0 };
    try {
      const raw = BigInt(results[index + 1] ?? '0x0');
      const formatted = Number(raw) / 10 ** token.decimals;
      return { symbol: token.symbol, raw, formatted, usd: formatted };
    } catch (err) {
      return {
        symbol: token.symbol,
        raw: BigInt(0),
        formatted: 0,
        usd: 0,
        error: err instanceof Error ? err.message : `${token.symbol} failed`,
      };
    }
  });

  return {
    raw: wei,
    formatted: Number(wei) / 1e18,
    stableCoins,
  };
}

async function evmRpcBatch(
  rpcUrls: string[],
  calls: Record<string, unknown>[],
  label: string
): Promise<string[]> {
  const errors: string[] = [];
  for (const rpc of rpcUrls) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calls),
      });
      if (!res.ok) {
        errors.push(`${rpc} ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        errors.push(`${rpc} did not return a batch response`);
        continue;
      }
      const sorted = [...data].sort((a, b) => Number(a.id) - Number(b.id));
      const failed = sorted.find((item) => item.error);
      if (failed) {
        errors.push(failed.error?.message ?? `${rpc} batch item failed`);
        continue;
      }
      return sorted.map((item) => item.result ?? '0x0');
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `${rpc} failed`);
    }
  }
  throw new Error(`${label} RPC batch failed: ${errors.join(' | ')}`);
}

/**
 * Fetch Solana balance via JSON-RPC (lamports).
 */
async function fetchSolBalances(
  chain: Chain,
  address: string
): Promise<BalanceResult> {
  const customRpc = getCustomSolanaRpcUrl();
  const rpcUrls = [
    ...(customRpc ? [customRpc] : []),
    ...(chain.rpcUrls ?? [
      'https://solana-mainnet.g.alchemy.com/v2/docs-demo',
      'https://docs-demo.solana-mainnet.quiknode.pro/',
      'https://api.mainnet-beta.solana.com',
      'https://solana-rpc.publicnode.com',
    ]),
  ];
  const tokens = chain.stableCoins ?? [];
  const balanceCall = {
    jsonrpc: '2.0',
    method: 'getBalance',
    params: [address],
    id: 1,
  };

  const { result: balanceResult, rpcUrl } = await solanaRpcSingle(rpcUrls, balanceCall);
  const lamports = balanceResult?.value ?? 0;

  // Token lookups are optional. Native SOL should still display if token calls are blocked.
  const stableCoins = await Promise.all(
    tokens.map(async (token, index) => {
      if (!token.mint) return { symbol: token.symbol, raw: 0, formatted: 0, usd: 0 };
      try {
        const tokenCall = {
          jsonrpc: '2.0',
          method: 'getTokenAccountsByOwner',
          params: [address, { mint: token.mint }, { encoding: 'jsonParsed' }],
          id: index + 2,
        };
        const { result } = await solanaRpcSingle([rpcUrl, ...rpcUrls.filter((url) => url !== rpcUrl)], tokenCall);
        const accounts = result?.value ?? [];
        const raw = accounts.reduce((sum: bigint, account: any) => {
          const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount ?? '0';
          return sum + BigInt(amount);
        }, BigInt(0));
        const formatted = Number(raw) / 10 ** token.decimals;
        return { symbol: token.symbol, raw, formatted, usd: formatted };
      } catch (err) {
        return {
          symbol: token.symbol,
          raw: 0,
          formatted: 0,
          usd: 0,
          error: err instanceof Error ? err.message : `${token.symbol} failed`,
        };
      }
    })
  );

  return { raw: lamports, formatted: lamports / 1e9, stableCoins };
}

function getCustomSolanaRpcUrl(): string {
  try {
    return localStorage.getItem('bip39-solana-rpc')?.trim() ?? '';
  } catch {
    return '';
  }
}

async function solanaRpcSingle(
  rpcUrls: string[],
  call: Record<string, unknown>
): Promise<{ result: any; rpcUrl: string }> {
  const errors: string[] = [];

  for (const rpcUrl of rpcUrls) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(call),
      });
      if (!res.ok) {
        errors.push(`${rpcUrl} ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data?.error) {
        errors.push(data.error.message ?? `${rpcUrl} RPC error`);
        continue;
      }
      return { result: data?.result, rpcUrl };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `${rpcUrl} failed`);
    }
  }

  throw new Error(`Solana RPC failed: ${errors.join(' | ')}`);
}

/**
 * Fetch USD prices for all supported chain native tokens from CoinGecko.
 */
export async function fetchPrices(): Promise<Record<string, number>> {
  const ids = [...new Set(CHAINS.map((c) => c.coingeckoId))].join(',');
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
  );
  if (!res.ok) throw new Error(`CoinGecko error ${res.status}`);
  const data = await res.json();
  const prices: Record<string, number> = {};
  for (const chain of CHAINS) {
    prices[chain.id] = data[chain.coingeckoId]?.usd ?? 0;
  }
  return prices;
}

const CHAINS = Object.values(CHAIN_BY_ID);

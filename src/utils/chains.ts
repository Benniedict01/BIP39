export interface Chain {
  id: string;
  name: string;
  symbol: string;
  coingeckoId: string;
  type: 'btc' | 'evm' | 'sol';
  color: string;
  derivationPath: string;
  rpcUrl?: string;
  rpcUrls?: string[];
  stableCoins?: StableCoin[];
}

export interface StableCoin {
  symbol: 'USDC' | 'USDT';
  address?: string;
  mint?: string;
  decimals: number;
}

export const CHAINS: Chain[] = [
  {
    id: 'btc',
    name: 'Bitcoin',
    symbol: 'BTC',
    coingeckoId: 'bitcoin',
    type: 'btc',
    color: '#f7931a',
    derivationPath: "m/44'/0'/0'/0/0",
  },
  {
    id: 'eth',
    name: 'Ethereum',
    symbol: 'ETH',
    coingeckoId: 'ethereum',
    type: 'evm',
    color: '#627eea',
    derivationPath: "m/44'/60'/0'/0/0",
    rpcUrl: 'https://rpc.ankr.com/eth',
    rpcUrls: ['https://rpc.ankr.com/eth', 'https://ethereum-rpc.publicnode.com'],
    stableCoins: [
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    ],
  },
  {
    id: 'polygon',
    name: 'Polygon',
    symbol: 'MATIC',
    coingeckoId: 'matic-network',
    type: 'evm',
    color: '#8247e5',
    derivationPath: "m/44'/60'/0'/0/0",
    rpcUrl: 'https://polygon-rpc.com',
    rpcUrls: [
      'https://polygon-rpc.com',
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon.drpc.org',
    ],
    stableCoins: [
      { symbol: 'USDC', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6 },
      { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    ],
  },
  {
    id: 'base',
    name: 'Base',
    symbol: 'ETH',
    coingeckoId: 'ethereum',
    type: 'evm',
    color: '#0052ff',
    derivationPath: "m/44'/60'/0'/0/0",
    rpcUrl: 'https://mainnet.base.org',
    rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    stableCoins: [
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
    ],
  },
  {
    id: 'bsc',
    name: 'BNB Chain',
    symbol: 'BNB',
    coingeckoId: 'binancecoin',
    type: 'evm',
    color: '#f3ba2f',
    derivationPath: "m/44'/60'/0'/0/0",
    rpcUrl: 'https://bsc-dataseed.binance.org',
    rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
    stableCoins: [
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    ],
  },
  {
    id: 'avalanche',
    name: 'Avalanche C-Chain',
    symbol: 'AVAX',
    coingeckoId: 'avalanche-2',
    type: 'evm',
    color: '#e84142',
    derivationPath: "m/44'/60'/0'/0/0",
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    rpcUrls: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche-c-chain-rpc.publicnode.com',
    ],
    stableCoins: [
      { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
      { symbol: 'USDT', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    ],
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum One',
    symbol: 'ETH',
    coingeckoId: 'ethereum',
    type: 'evm',
    color: '#28a0f0',
    derivationPath: "m/44'/60'/0'/0/0",
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    stableCoins: [
      { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    ],
  },
  {
    id: 'optimism',
    name: 'Optimism',
    symbol: 'ETH',
    coingeckoId: 'ethereum',
    type: 'evm',
    color: '#ff0420',
    derivationPath: "m/44'/60'/0'/0/0",
    rpcUrl: 'https://mainnet.optimism.io',
    rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
    stableCoins: [
      { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
      { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    ],
  },
  {
    id: 'sol-phantom',
    name: 'Solana Phantom',
    symbol: 'SOL',
    coingeckoId: 'solana',
    type: 'sol',
    color: '#14f195',
    derivationPath: "m/44'/501'/0'/0'",
    rpcUrls: [
      'https://solana-mainnet.g.alchemy.com/v2/docs-demo',
      'https://docs-demo.solana-mainnet.quiknode.pro/',
      'https://api.mainnet-beta.solana.com',
      'https://solana-rpc.publicnode.com',
      'https://solana.drpc.org',
      'https://rpc.ankr.com/solana',
    ],
    stableCoins: [
      { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4SmKConKYJCS8mabwNYB', decimals: 6 },
    ],
  },
  {
    id: 'sol-bip44',
    name: 'Solana BIP-44',
    symbol: 'SOL',
    coingeckoId: 'solana',
    type: 'sol',
    color: '#14f195',
    derivationPath: "m/44'/501'/0'",
    rpcUrls: [
      'https://solana-mainnet.g.alchemy.com/v2/docs-demo',
      'https://docs-demo.solana-mainnet.quiknode.pro/',
      'https://api.mainnet-beta.solana.com',
      'https://solana-rpc.publicnode.com',
      'https://solana.drpc.org',
      'https://rpc.ankr.com/solana',
    ],
    stableCoins: [
      { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4SmKConKYJCS8mabwNYB', decimals: 6 },
    ],
  },
];

export const CHAIN_BY_ID: Record<string, Chain> = CHAINS.reduce((acc, c) => {
  acc[c.id] = c;
  return acc;
}, {} as Record<string, Chain>);

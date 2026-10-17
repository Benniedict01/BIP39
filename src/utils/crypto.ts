import { HDKey } from '@scure/bip32';
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base58check, base58 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { derivePath, getPublicKey as ed25519GetPublicKey } from 'ed25519-hd-key';
import { CHAINS, type Chain } from './chains.js';

const b58check = base58check(sha256);

export interface ChainAddress {
  chainId: string;
  address: string;
  path: string;
}

/**
 * Pick 12 random words from the BIP-39 wordlist.
 * These are NOT generated from entropy — most will fail the checksum.
 */
export function generateRandomWords(): string[] {
  const words: string[] = [];
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 12; i++) {
    words.push(wordlist[buf[i] % 2048]);
  }
  return words;
}

/**
 * Generate a cryptographically-valid 12-word BIP-39 mnemonic.
 * Uses 128-bit entropy → 12 words with valid checksum.
 */
export function generateValidMnemonicWords(): string[] {
  return generateMnemonic(wordlist, 128).split(' ');
}

/**
 * Validate whether a set of words forms a valid BIP-39 mnemonic
 * (correct word count, all words in list, checksum passes).
 */
export function checkValidity(words: string[]): boolean {
  return validateMnemonic(words.join(' '), wordlist);
}

/**
 * Parse a free-form phrase string into a clean word array.
 */
export function normalizePhrase(input: string): string[] {
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * From a valid mnemonic, derive addresses for every supported chain.
 */
export function deriveAllAddresses(words: string[]): ChainAddress[] {
  const mnemonic = words.join(' ');
  const seed = mnemonicToSeedSync(mnemonic);
  const seedHex = bytesToHex(seed);

  // Pre-derive secp256k1 master once for BTC + all EVM chains
  const secpMaster = HDKey.fromMasterSeed(seed);

  return CHAINS.map((chain) => {
    const address = deriveAddressForChain(chain, secpMaster, seedHex);
    return { chainId: chain.id, address, path: chain.derivationPath };
  });
}

function deriveAddressForChain(chain: Chain, secpMaster: HDKey, seedHex: string): string {
  if (chain.type === 'btc') {
    return deriveBtcP2pkh(secpMaster, chain.derivationPath);
  }

  if (chain.type === 'evm') {
    return deriveEvmAddress(secpMaster, chain.derivationPath);
  }

  if (chain.type === 'sol') {
    return deriveSolanaAddress(seedHex, chain.derivationPath);
  }

  throw new Error(`Unsupported chain type: ${chain.type}`);
}

function deriveBtcP2pkh(master: HDKey, path: string): string {
  const child = master.derive(path);
  const pubkey = child.publicKey!;
  const hash160 = ripemd160(sha256(pubkey));
  const payload = new Uint8Array(21);
  payload[0] = 0x00; // mainnet P2PKH
  payload.set(hash160, 1);
  return b58check.encode(payload);
}

function deriveEvmAddress(master: HDKey, path: string): string {
  const child = master.derive(path);
  const privKey = child.privateKey!;
  const uncompressedPub = secp256k1.getPublicKey(privKey, false);
  const hash = keccak_256(uncompressedPub.slice(1));
  return toChecksumAddress(bytesToHex(hash.slice(-20)));
}

function deriveSolanaAddress(seedHex: string, path: string): string {
  const { key } = derivePath(path, seedHex);
  const pubKey = ed25519GetPublicKey(key, false); // 32-byte Solana pubkey
  return base58.encode(pubKey);
}

/**
 * EIP-55 mixed-case checksum encoding.
 */
function toChecksumAddress(addr: string): string {
  const lower = addr.toLowerCase().replace('0x', '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

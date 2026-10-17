import { useState, useCallback, useEffect, useRef } from 'react';
import {
  generateRandomWords,
  generateValidMnemonicWords,
  checkValidity,
  deriveAllAddresses,
  normalizePhrase,
  type ChainAddress,
} from './utils/crypto';
import { fetchBalance, fetchPrices, type ChainBalance } from './utils/blockchain';
import { CHAIN_BY_ID } from './utils/chains';
import { downloadProjectSnapshot } from './utils/projectSnapshot';

/* ──────────────────────────────────────────────
   Types
   ────────────────────────────────────────────── */

interface PhraseEntry {
  id: string;
  words: string[];
  isValid: boolean;
  addresses: ChainAddress[];
  balances: Record<string, ChainBalance>;
  totalUsd: number;
  balanceStatus: 'idle' | 'loading' | 'done' | 'error';
  balanceError?: string;
}

type SortMode = 'newest' | 'usd-high' | 'usd-low';
type Page = 'explorer' | 'checker';
type AutoLimit = 25 | 100 | 250 | 500;

const HISTORY_KEY = 'bip39_phrase_history_v2';

function phraseKey(words: string[]): string {
  return normalizePhrase(words.join(' ')).join(' ');
}

function loadHistory(): PhraseEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PhraseEntry[];
  } catch {
    return [];
  }
}

function saveHistory(phrases: PhraseEntry[]) {
  const safe = phrases.map((phrase) => ({
    ...phrase,
    balances: Object.fromEntries(
      Object.entries(phrase.balances).map(([chainId, balance]) => [
        chainId,
        {
          ...balance,
          raw: balance.raw.toString(),
          stableCoins: balance.stableCoins?.map((token) => ({
            ...token,
            raw: token.raw.toString(),
          })),
        },
      ])
    ),
  }));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(safe));
}

/* ──────────────────────────────────────────────
   App
   ────────────────────────────────────────────── */

export default function App() {
  const [page, setPage] = useState<Page>('explorer');
  const [phrases, setPhrases] = useState<PhraseEntry[]>(() => loadHistory());
  const [prices, setPrices] = useState<Record<string, number> | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [checkingAll, setCheckingAll] = useState(false);
  const [autoScanning, setAutoScanning] = useState(false);
  const [autoScanned, setAutoScanned] = useState(0);
  const [autoLimit, setAutoLimit] = useState<AutoLimit>(25);
  const stopAutoRef = useRef(false);
  const seenPhraseKeysRef = useRef<Set<string>>(
    new Set(phrases.map((phrase) => phraseKey(phrase.words)))
  );

  useEffect(() => {
    saveHistory(phrases);
    seenPhraseKeysRef.current = new Set(phrases.map((phrase) => phraseKey(phrase.words)));
  }, [phrases]);

  /* ── helpers ─────────────────────────────── */

  const ensurePrices = useCallback(async () => {
    if (prices) return prices;
    const p = await fetchPrices();
    setPrices(p);
    return p;
  }, [prices]);

  const getUniqueRandomWords = useCallback(() => {
    for (let i = 0; i < 5000; i++) {
      const words = generateRandomWords();
      if (!seenPhraseKeysRef.current.has(phraseKey(words))) return words;
    }
    return null;
  }, []);

  const addPhrase = useCallback((words: string[]) => {
    const key = phraseKey(words);
    if (seenPhraseKeysRef.current.has(key)) return null;

    const isValid = checkValidity(words);
    let addresses: ChainAddress[] = [];
    if (isValid) {
      try {
        addresses = deriveAllAddresses(words);
      } catch {
        // derivation failed — treat as invalid
      }
    }
    const entry: PhraseEntry = {
      id: crypto.randomUUID(),
      words,
      isValid,
      addresses,
      balances: {},
      totalUsd: 0,
      balanceStatus: 'idle',
    };
    seenPhraseKeysRef.current.add(key);
    setPhrases((prev) => [entry, ...prev]);
    return entry;
  }, []);

  const checkBalance = useCallback(
    async (id: string, explicitPrices?: Record<string, number> | null) => {
      // Snapshot current addresses from state
      let addrs: ChainAddress[] = [];
      setPhrases((prev) => {
        const found = prev.find((p) => p.id === id);
        if (found) addrs = found.addresses;
        return prev.map((p) =>
          p.id === id ? { ...p, balanceStatus: 'loading' as const } : p
        );
      });
      await new Promise((r) => setTimeout(r, 10));

      if (addrs.length === 0) {
        setPhrases((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  balanceStatus: 'error' as const,
                  balanceError: 'No addresses derived',
                }
              : p
          )
        );
        return;
      }

      const currentPrices = explicitPrices ?? (await ensurePrices());
      const balances: Record<string, ChainBalance> = {};
      let totalUsd = 0;
      let lastError = '';

      const results = await Promise.all(
        addrs.map(async ({ chainId, address }) => {
          const chain = CHAIN_BY_ID[chainId];
          if (!chain) return null;
          try {
            const { raw, formatted, stableCoins } = await fetchBalance(chain, address);
            const price = currentPrices?.[chainId] ?? 0;
            const stableUsd = stableCoins?.reduce((sum, token) => sum + token.usd, 0) ?? 0;
            const usd = formatted * price + stableUsd;
            return { chainId, balance: { chainId, raw, formatted, usd, stableCoins } };
          } catch (err) {
            const error = err instanceof Error ? err.message : 'Fetch failed';
            return {
              chainId,
              error,
              balance: {
                chainId,
                raw: chain.type === 'evm' ? BigInt(0) : 0,
                formatted: 0,
                usd: 0,
                error,
              },
            };
          }
        })
      );

      for (const result of results) {
        if (!result) continue;
        balances[result.chainId] = result.balance;
        totalUsd += result.balance.usd;
        if ('error' in result && result.error) lastError = result.error;
      }

      setPhrases((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                balances,
                totalUsd,
                balanceStatus: 'done' as const,
                balanceError: lastError || undefined,
              }
            : p
        )
      );
    },
    [ensurePrices]
  );

  const checkAllBalances = useCallback(async () => {
    setCheckingAll(true);
    const p = await ensurePrices();
    const ids = phrases
      .filter((ph) => ph.isValid && ph.addresses.length > 0)
      .map((ph) => ph.id);
    for (let i = 0; i < ids.length; i += 3) {
      await Promise.all(ids.slice(i, i + 3).map((id) => checkBalance(id, p)));
      await new Promise((r) => setTimeout(r, 120));
    }
    setCheckingAll(false);
  }, [phrases, checkBalance, ensurePrices]);

  const generateAndScanOne = useCallback(async () => {
    const p = await ensurePrices();
    const words = getUniqueRandomWords();
    if (!words) return;
    const entry = addPhrase(words);
    if (!entry) return;
    if (!entry.isValid) return;
    await new Promise((r) => setTimeout(r, 50));
    await checkBalance(entry.id, p);
  }, [addPhrase, checkBalance, ensurePrices, getUniqueRandomWords]);

  const startAutoScan = useCallback(async () => {
    if (autoScanning) return;
    stopAutoRef.current = false;
    setAutoScanning(true);
    setAutoScanned(0);

    const p = await ensurePrices();
    for (let i = 0; i < autoLimit; i++) {
      if (stopAutoRef.current) break;
      const words = getUniqueRandomWords();
      if (!words) break;
      const entry = addPhrase(words);
      if (!entry) continue;
      if (entry.isValid) {
        await new Promise((r) => setTimeout(r, 75));
        await checkBalance(entry.id, p);
      }
      setAutoScanned((count) => count + 1);
      await new Promise((r) => setTimeout(r, entry.isValid ? 140 : 25));
    }

    setAutoScanning(false);
  }, [addPhrase, autoLimit, autoScanning, checkBalance, ensurePrices, getUniqueRandomWords]);

  const stopAutoScan = useCallback(() => {
    stopAutoRef.current = true;
    setAutoScanning(false);
  }, []);

  const removePhrase = (id: string) => {
    setPhrases((prev) => prev.filter((p) => p.id !== id));
  };

  const clearAll = () => setPhrases([]);

  /* ── sorted list ─────────────────────────── */

  const sorted = phrases
    .map((phrase, index) => ({ phrase, index }))
    .sort((a, b) => {
      if (sortMode === 'usd-high') return b.phrase.totalUsd - a.phrase.totalUsd || a.index - b.index;
      if (sortMode === 'usd-low') return a.phrase.totalUsd - b.phrase.totalUsd || a.index - b.index;
      return a.index - b.index;
    })
    .map(({ phrase }) => phrase);

  /* ── render ──────────────────────────────── */

  return (
    <div className="min-h-screen bg-[#0a0e17] text-slate-200">
      {/* Header */}
      <header className="border-b border-slate-800 bg-[#0d1220]">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-orange-600/20">
                <svg
                  className="h-7 w-7 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  BIP-39 Phrase Explorer
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Real multi-chain derivation &middot; Transparent validity &middot; Live balances
                </p>
              </div>
            </div>

            <nav className="flex items-center gap-2 rounded-lg bg-slate-900 p-1 ring-1 ring-slate-800">
              <button
                onClick={() => setPage('explorer')}
                className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                  page === 'explorer'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Explorer
              </button>
              <button
                onClick={() => setPage('checker')}
                className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                  page === 'checker'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Manual Checker
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <SolanaRpcSettings />
        <ProjectDownloadPanel />

        {page === 'explorer' ? (
          <ExplorerView
            phrases={sorted}
            prices={prices}
            sortMode={sortMode}
            checkingAll={checkingAll}
            autoScanning={autoScanning}
            autoScanned={autoScanned}
            autoLimit={autoLimit}
            onGenerateRandom={() => {
              const words = getUniqueRandomWords();
              if (words) addPhrase(words);
            }}
            onGenerateValid={() => addPhrase(generateValidMnemonicWords())}
            onGenerateAndScan={generateAndScanOne}
            onStartAutoScan={startAutoScan}
            onStopAutoScan={stopAutoScan}
            onAutoLimitChange={setAutoLimit}
            onCheckAll={checkAllBalances}
            onCheckOne={checkBalance}
            onRemove={removePhrase}
            onClear={clearAll}
            onSortChange={setSortMode}
            onRefreshPrices={ensurePrices}
          />
        ) : (
          <ManualCheckerView />
        )}

        <footer className="mt-12 border-t border-slate-800/60 py-6 text-center text-[11px] leading-relaxed text-slate-600">
          <p>
            <strong className="text-slate-500">Educational tool.</strong> Supports BTC, ETH,
            Polygon, Base, BNB Chain, Avalanche, Arbitrum, Optimism, Solana Phantom, and Solana BIP-44.
          </p>
          <p className="mt-1">
            Balances from public RPCs / APIs. Prices from CoinGecko. BIP-39 English wordlist.
          </p>
        </footer>
      </main>
    </div>
  );
}

function SolanaRpcSettings() {
  const [rpc, setRpc] = useState(() => {
    try {
      return localStorage.getItem('bip39-solana-rpc') ?? '';
    } catch {
      return '';
    }
  });
  const [saved, setSaved] = useState(false);

  const save = () => {
    try {
      const clean = rpc.trim();
      if (clean) localStorage.setItem('bip39-solana-rpc', clean);
      else localStorage.removeItem('bip39-solana-rpc');
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setSaved(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-slate-800 bg-[#0d1220]/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Optional custom Solana RPC
          </label>
          <input
            value={rpc}
            onChange={(e) => setRpc(e.target.value)}
            placeholder="https://your-solana-rpc-provider.example.com/..."
            className="mt-2 w-full rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-slate-200 ring-1 ring-slate-700 placeholder:text-slate-700 focus:outline-none focus:ring-amber-500"
          />
          <p className="mt-1 text-[11px] text-slate-600">
            Public Solana RPCs often block browser requests or rate-limit. Add an Alchemy, Helius,
            QuickNode, or other RPC URL here if Solana still fails.
          </p>
        </div>
        <button
          onClick={save}
          className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700"
        >
          {saved ? 'Saved' : 'Save RPC'}
        </button>
      </div>
    </div>
  );
}

function ProjectDownloadPanel() {
  return (
    <div className="mb-5 rounded-xl border border-slate-800 bg-[#0d1220]/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Export this site source</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
            Download a JSON snapshot containing the React UI, utility code, chain config, package
            metadata, Vite config, and HTML entry point so the project can be restored later.
          </p>
        </div>
        <button
          onClick={downloadProjectSnapshot}
          className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white ring-1 ring-amber-500/40 transition hover:bg-amber-600"
        >
          Download Source Snapshot
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Explorer View
   ────────────────────────────────────────────── */

function ExplorerView({
  phrases,
  prices,
  sortMode,
  checkingAll,
  autoScanning,
  autoScanned,
  autoLimit,
  onGenerateRandom,
  onGenerateValid,
  onGenerateAndScan,
  onStartAutoScan,
  onStopAutoScan,
  onAutoLimitChange,
  onCheckAll,
  onCheckOne,
  onRemove,
  onClear,
  onSortChange,
  onRefreshPrices,
}: {
  phrases: PhraseEntry[];
  prices: Record<string, number> | null;
  sortMode: SortMode;
  checkingAll: boolean;
  autoScanning: boolean;
  autoScanned: number;
  autoLimit: AutoLimit;
  onGenerateRandom: () => void;
  onGenerateValid: () => void;
  onGenerateAndScan: () => void;
  onStartAutoScan: () => void;
  onStopAutoScan: () => void;
  onAutoLimitChange: (limit: AutoLimit) => void;
  onCheckAll: () => void;
  onCheckOne: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSortChange: (m: SortMode) => void;
  onRefreshPrices: () => Promise<Record<string, number>>;
}) {
  const hasValid = phrases.some((p) => p.isValid);
  const scannedCount = phrases.filter(
    (p) => p.isValid && (p.balanceStatus === 'done' || p.balanceStatus === 'error')
  ).length;
  const totalScannedUsd = phrases.reduce((sum, phrase) => sum + phrase.totalUsd, 0);
  const valueRankings = [...phrases]
    .filter((phrase) => phrase.totalUsd >= 0.01)
    .sort((a, b) => b.totalUsd - a.totalUsd);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onGenerateRandom}
          className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 active:scale-[0.97]"
        >
          🎲 Random 12 Words
        </button>
        <button
          onClick={onGenerateValid}
          className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-700/20 transition hover:from-amber-500 hover:to-orange-500 active:scale-[0.97]"
        >
          ✅ Generate Valid Mnemonic
        </button>
        <button
          onClick={onGenerateAndScan}
          disabled={autoScanning}
          className="rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.97]"
        >
          Random Pick + Scan If Valid
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Auto amount
            <select
              value={autoLimit}
              onChange={(e) => onAutoLimitChange(Number(e.target.value) as AutoLimit)}
              disabled={autoScanning}
              className="rounded-md bg-slate-900 px-2 py-2 text-slate-300 ring-1 ring-slate-700 focus:outline-none focus:ring-amber-500 disabled:opacity-50"
            >
              <option value={25}>25</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </label>
          <span className="max-w-xs text-[11px] leading-snug text-slate-600">
            Duplicate phrases are skipped permanently from your local history.
          </span>
          {!autoScanning ? (
            <button
              onClick={onStartAutoScan}
              className="rounded-lg bg-cyan-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-700 active:scale-[0.97]"
            >
              Auto Random Picks ({autoLimit})
            </button>
          ) : (
            <button
              onClick={onStopAutoScan}
              className="rounded-lg bg-red-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 active:scale-[0.97]"
            >
              Stop Auto ({autoScanned}/{autoLimit})
            </button>
          )}
          {hasValid && (
            <button
              onClick={onCheckAll}
              disabled={checkingAll}
              className="rounded-lg bg-emerald-700/80 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50 active:scale-[0.97]"
            >
              {checkingAll ? '⏳ Checking…' : '💰 Check All Balances'}
            </button>
          )}
          {phrases.length > 0 && (
            <button
              onClick={onClear}
              className="rounded-lg px-3 py-2.5 text-sm text-slate-500 transition hover:text-red-400"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Total value memory */}
      <div className="rounded-xl border border-slate-800 bg-[#0d1220] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-600">
              Total scanned value
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold text-emerald-400">
              ${totalScannedUsd.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {scannedCount} scanned valid phrase{scannedCount === 1 ? '' : 's'} in memory
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Records only phrases worth <span className="text-slate-300">$0.01+</span>. Zero-value
            phrases are ignored in the ranking.
          </div>
        </div>

        {valueRankings.length > 0 && (
          <div className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1">
            {valueRankings.map((phrase, index) => (
              <div
                key={phrase.id}
                className="flex flex-col gap-1 rounded-lg bg-black/20 px-3 py-2 ring-1 ring-slate-800/70 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="w-8 text-xs font-semibold text-slate-500">#{index + 1}</span>
                <span className="font-mono text-sm font-semibold text-emerald-400">
                  ${phrase.totalUsd.toFixed(2)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">
                  {phrase.words.join(' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sort bar */}
      {phrases.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded bg-slate-900 px-2 py-1 text-slate-400 ring-1 ring-slate-800">
            History: {phrases.length}
          </span>
          <span>Sort:</span>
          {(['newest', 'usd-high', 'usd-low'] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onSortChange(mode)}
              className={`rounded-md px-2.5 py-1 transition ${
                sortMode === mode ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {mode === 'newest' && 'Newest'}
              {mode === 'usd-high' && '$ High → Low'}
              {mode === 'usd-low' && '$ Low → High'}
            </button>
          ))}
          {prices && (
            <span className="ml-auto text-[11px] text-slate-600">
              Prices loaded &middot; {Object.keys(prices).length} assets
            </span>
          )}
          {!prices && (
            <button
              onClick={onRefreshPrices}
              className="ml-auto text-[11px] text-slate-500 hover:text-slate-300"
            >
              Load prices
            </button>
          )}
        </div>
      )}

      {/* Phrase list */}
      <div className="space-y-4">
        {phrases.map((entry) => (
          <PhraseCard
            key={entry.id}
            entry={entry}
            prices={prices}
            onCheckBalance={() => onCheckOne(entry.id)}
            onRemove={() => onRemove(entry.id)}
          />
        ))}
      </div>

      {phrases.length === 0 && (
        <div className="mt-20 text-center">
          <p className="text-lg text-slate-600">Generate some phrases to get started.</p>
          <p className="mt-2 text-sm text-slate-700">
            Random picks will mostly be <span className="text-red-400">invalid</span>. Valid
            mnemonics derive <span className="text-emerald-400">real</span> addresses across 10
            chains.
          </p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Manual Checker View
   ────────────────────────────────────────────── */

function ManualCheckerView() {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [words, setWords] = useState<string[] | null>(null);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [addresses, setAddresses] = useState<ChainAddress[]>([]);
  const [balances, setBalances] = useState<Record<string, ChainBalance>>({});
  const [totalUsd, setTotalUsd] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [statusError, setStatusError] = useState('');
  const [prices, setPrices] = useState<Record<string, number> | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWords(null);
    setIsValid(null);
    setAddresses([]);
    setBalances({});
    setTotalUsd(0);
    setStatus('idle');

    const normalized = normalizePhrase(input);
    if (
      normalized.length !== 12 &&
      normalized.length !== 15 &&
      normalized.length !== 18 &&
      normalized.length !== 21 &&
      normalized.length !== 24
    ) {
      setError('BIP-39 mnemonics are usually 12, 15, 18, 21, or 24 words.');
      return;
    }

    const valid = checkValidity(normalized);
    setWords(normalized);
    setIsValid(valid);

    if (valid) {
      try {
        const addrs = deriveAllAddresses(normalized);
        setAddresses(addrs);
      } catch {
        setIsValid(false);
        setError('Address derivation failed.');
      }
    }
  };

  const handleCheckBalances = async () => {
    if (!isValid || addresses.length === 0) return;
    setStatus('loading');
    setStatusError('');

    let currentPrices = prices;
    if (!currentPrices) {
      try {
        currentPrices = await fetchPrices();
        setPrices(currentPrices);
      } catch {
        currentPrices = {};
      }
    }

    const newBalances: Record<string, ChainBalance> = {};
    let total = 0;
    let lastErr = '';

    for (const { chainId, address } of addresses) {
      const chain = CHAIN_BY_ID[chainId];
      if (!chain) continue;
      try {
        const { raw, formatted, stableCoins } = await fetchBalance(chain, address);
        const price = currentPrices?.[chainId] ?? 0;
        const stableUsd = stableCoins?.reduce((sum, token) => sum + token.usd, 0) ?? 0;
        const usd = formatted * price + stableUsd;
        newBalances[chainId] = { chainId, raw, formatted, usd, stableCoins };
        total += usd;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : 'Fetch failed';
        newBalances[chainId] = {
          chainId,
          raw: chain.type === 'evm' ? BigInt(0) : 0,
          formatted: 0,
          usd: 0,
          error: lastErr,
        };
      }
    }

    setBalances(newBalances);
    setTotalUsd(total);
    setStatus('done');
    setStatusError(lastErr);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-slate-800 bg-[#0d1220] p-6">
        <h2 className="text-lg font-semibold text-white">Check a phrase manually</h2>
        <p className="mt-1 text-sm text-slate-500">
          Paste any BIP-39 phrase. We'll validate it and, if valid, derive addresses.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="abandon ability able about above absent absorb abstract absurd abuse accident account achieve..."
            rows={4}
            className="w-full resize-y rounded-lg bg-black/40 p-4 font-mono text-sm text-slate-200 ring-1 ring-slate-700 placeholder:text-slate-700 focus:outline-none focus:ring-amber-500"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-amber-500 hover:to-orange-500 active:scale-[0.98]"
          >
            Validate & Derive
          </button>
        </form>
      </div>

      {isValid !== null && words && (
        <div
          className={`rounded-xl border p-6 ${
            isValid
              ? 'border-emerald-900/50 bg-[#0f1a14]'
              : 'border-red-900/30 bg-[#1a0f0f]'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                isValid
                  ? 'bg-emerald-900/60 text-emerald-400'
                  : 'bg-red-900/40 text-red-400'
              }`}
            >
              {isValid ? '✓ Valid' : '✗ Invalid'}
            </span>
            <span className="text-sm text-slate-400">{words.length} words</span>
          </div>

          {!isValid && (
            <p className="mt-3 text-xs leading-relaxed text-red-400/70">
              This phrase does not satisfy the BIP-39 checksum. No deterministic keys or addresses
              can be derived from it.
            </p>
          )}

          {isValid && addresses.length > 0 && (
            <div className="mt-4 space-y-2">
              {addresses.map(({ chainId, address, path }) => {
                const chain = CHAIN_BY_ID[chainId];
                const bal = balances[chainId];
                return (
                  <div
                    key={chainId}
                    className="rounded-lg bg-black/20 p-3 ring-1 ring-slate-800/60"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ backgroundColor: `${chain.color}20`, color: chain.color }}
                      >
                        {chain.symbol}
                      </span>
                      <span className="text-xs font-medium text-slate-400">{chain.name}</span>
                      <code className="break-all text-xs text-slate-500">{address}</code>
                      <span className="text-[10px] text-slate-600">{path}</span>
                    </div>
                    {status === 'done' && bal && (
                      <div className="mt-1.5 space-y-1 text-xs">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-mono text-slate-300">
                            {bal.formatted.toFixed(chain.type === 'btc' ? 8 : 6)} {chain.symbol}
                          </span>
                          <span className={bal.usd > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                            ${bal.usd.toFixed(2)} total
                          </span>
                          {bal.error && (
                            <span className="text-red-400/80">RPC failed: {bal.error}</span>
                          )}
                        </div>
                        {bal.stableCoins && bal.stableCoins.length > 0 && (
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            {bal.stableCoins.map((token) => (
                              <span key={token.symbol} className="rounded bg-slate-900 px-2 py-1 text-slate-400">
                                {token.symbol}: {token.formatted.toFixed(2)} (${token.usd.toFixed(2)})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center gap-3 pt-1">
                {status === 'idle' && (
                  <button
                    onClick={handleCheckBalances}
                    className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700"
                  >
                    Check Balances
                  </button>
                )}
                {status === 'loading' && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-amber-400" />
                    Querying blockchains…
                  </span>
                )}
                {status === 'done' && (
                  <span className="text-[11px] text-slate-600">
                    ✓ Balances checked
                    {!prices && ' (no price data)'}
                    {totalUsd > 0 && (
                      <span className="ml-2 font-mono text-emerald-400">
                        Total: ${totalUsd.toFixed(2)}
                      </span>
                    )}
                    {statusError && (
                      <span className="ml-2 text-red-400/80">Some RPCs failed</span>
                    )}
                  </span>
                )}
                {status === 'error' && (
                  <span className="text-[11px] text-red-400/80">
                    ⚠ {statusError || 'Failed to fetch balances'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-800/60 bg-[#0d1220]/50 p-4 text-xs leading-relaxed text-slate-600">
        <p>
          <strong className="text-slate-500">Privacy note:</strong> Validation and derivation happen
          locally in your browser. Balance checks query public blockchain APIs only when you click
          <em> Check Balances</em>.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Phrase Card
   ────────────────────────────────────────────── */

function PhraseCard({
  entry,
  prices,
  onCheckBalance,
  onRemove,
}: {
  entry: PhraseEntry;
  prices: Record<string, number> | null;
  onCheckBalance: () => void;
  onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const copyPhrase = () => {
    navigator.clipboard.writeText(entry.words.join(' '));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={`rounded-xl border transition-colors ${
        entry.isValid
          ? 'border-emerald-900/50 bg-[#0f1a14]'
          : 'border-red-900/30 bg-[#1a0f0f]'
      }`}
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-slate-300">
          <svg
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
            entry.isValid
              ? 'bg-emerald-900/60 text-emerald-400'
              : 'bg-red-900/40 text-red-400'
          }`}
        >
          {entry.isValid ? '✓ Valid' : '✗ Invalid'}
        </span>

        {!entry.isValid && (
          <span className="text-[11px] text-red-400/60">
            checksum mismatch — cannot derive keys
          </span>
        )}

        {entry.isValid && entry.balanceStatus === 'done' && (
          <span className="ml-auto font-mono text-sm font-semibold text-emerald-400">
            ${entry.totalUsd.toFixed(2)}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={copyPhrase}
            className="text-xs text-slate-500 transition hover:text-slate-300"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onClick={onRemove}
            className="text-xs text-slate-600 transition hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-5 sm:px-5">
          {/* Word grid */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {entry.words.map((word, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 ring-1 ring-slate-800"
              >
                <span className="text-[10px] tabular-nums text-slate-600">{i + 1}.</span>
                <span className="font-mono text-sm text-slate-300">{word}</span>
              </div>
            ))}
          </div>

          {/* Addresses & balances */}
          {entry.isValid && entry.addresses.length > 0 && (
            <div className="mt-4 space-y-2">
              {entry.addresses.map(({ chainId, address, path }) => {
                const chain = CHAIN_BY_ID[chainId];
                const bal = entry.balances[chainId];
                return (
                  <div
                    key={chainId}
                    className="rounded-lg bg-black/20 p-3 ring-1 ring-slate-800/60"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ backgroundColor: `${chain.color}20`, color: chain.color }}
                      >
                        {chain.symbol}
                      </span>
                      <span className="text-xs font-medium text-slate-400">{chain.name}</span>
                      <code className="break-all text-xs text-slate-500">{address}</code>
                      <span className="text-[10px] text-slate-600">{path}</span>
                    </div>
                    {entry.balanceStatus === 'done' && bal && (
                      <div className="mt-1.5 space-y-1 text-xs">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-mono text-slate-300">
                            {bal.formatted.toFixed(chain.type === 'btc' ? 8 : 6)} {chain.symbol}
                          </span>
                          <span className={bal.usd > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                            ${bal.usd.toFixed(2)} total
                          </span>
                          {bal.error && (
                            <span className="text-red-400/80">RPC failed: {bal.error}</span>
                          )}
                        </div>
                        {bal.stableCoins && bal.stableCoins.length > 0 && (
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            {bal.stableCoins.map((token) => (
                              <span key={token.symbol} className="rounded bg-slate-900 px-2 py-1 text-slate-400">
                                {token.symbol}: {token.formatted.toFixed(2)} (${token.usd.toFixed(2)})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Balance actions */}
              <div className="flex items-center gap-3 pt-1">
                {entry.balanceStatus === 'idle' && (
                  <button
                    onClick={onCheckBalance}
                    className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700"
                  >
                    Check Balances
                  </button>
                )}
                {entry.balanceStatus === 'loading' && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-amber-400" />
                    Querying blockchains…
                  </span>
                )}
                {entry.balanceStatus === 'done' && (
                  <span className="text-[11px] text-slate-600">
                    ✓ Balances checked
                    {!prices && ' (no price data)'}
                    {entry.balanceError && (
                      <span className="ml-2 text-red-400/80">Some RPCs failed</span>
                    )}
                  </span>
                )}
                {entry.balanceStatus === 'error' && (
                  <span className="text-[11px] text-red-400/80">
                    ⚠ {entry.balanceError ?? 'Failed to fetch balances'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Invalid explanation */}
          {!entry.isValid && (
            <div className="mt-3 rounded-lg bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-400/70 ring-1 ring-red-900/20">
              <strong>Why invalid?</strong> BIP-39 encodes entropy + a checksum into the words.
              Randomly picking words almost never satisfies the checksum, so no deterministic keys
              or addresses can be derived.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

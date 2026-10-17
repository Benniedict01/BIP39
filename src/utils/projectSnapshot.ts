import appTsx from '../App.tsx?raw';
import mainTsx from '../main.tsx?raw';
import indexCss from '../index.css?raw';
import blockchainTs from './blockchain.ts?raw';
import chainsTs from './chains.ts?raw';
import cryptoTs from './crypto.ts?raw';
import cnTs from './cn.ts?raw';
import projectSnapshotTs from './projectSnapshot.ts?raw';
import indexHtml from '../../index.html?raw';
import packageJson from '../../package.json?raw';
import tsconfigJson from '../../tsconfig.json?raw';
import viteConfig from '../../vite.config.ts?raw';

const files = [
  { path: 'src/App.tsx', content: appTsx },
  { path: 'src/main.tsx', content: mainTsx },
  { path: 'src/index.css', content: indexCss },
  { path: 'src/utils/blockchain.ts', content: blockchainTs },
  { path: 'src/utils/chains.ts', content: chainsTs },
  { path: 'src/utils/crypto.ts', content: cryptoTs },
  { path: 'src/utils/cn.ts', content: cnTs },
  { path: 'src/utils/projectSnapshot.ts', content: projectSnapshotTs },
  { path: 'src/vite-env.d.ts', content: '/// <reference types="vite/client" />\n' },
  { path: 'index.html', content: indexHtml },
  { path: 'package.json', content: packageJson },
  { path: 'tsconfig.json', content: tsconfigJson },
  { path: 'vite.config.ts', content: viteConfig },
];

export function downloadProjectSnapshot() {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    app: 'BIP-39 Phrase Explorer',
    note:
      'This JSON contains the source files and configuration needed to recreate the current app. Do not paste real seed phrases into untrusted deployments.',
    files,
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bip39-phrase-explorer-source-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

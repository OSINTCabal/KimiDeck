// Kimi for Linux entry: load the Linux integration shim (CJS) then the original obfuscated ESM main.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try { require('./linux-shim.cjs'); } catch (e) { console.error('[kimi-linux] shim failed:', e); }
await import('./index.js');

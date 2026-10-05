import { readdir, readFile, lstat, access } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const findings = [];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}/,
  /gh[pousr]_[0-9A-Za-z]{30,}/,
  /github_pat_[0-9A-Za-z_]{50,}/,
  /AKIA[0-9A-Z]{16}/,
  /"private_key"\s*:\s*"[^"]{24,}/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_+\/-]{24,}["']/i,
  /[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook)\.com/i,
  /[A-Z]:[\\/]Users[\\/][^\s]+/i,
];
const terms = process.env.PRIVATE_TERMS_FILE
  ? (await readFile(process.env.PRIVATE_TERMS_FILE, 'utf8')).split(/\r?\n/).filter(Boolean) : [];

async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = resolve(dir, entry.name), name = relative(root, path).replaceAll('\\', '/');
    if ((await lstat(path)).isSymbolicLink()) { findings.push(name + ': unexpected symlink'); continue; }
    if (entry.isDirectory()) { await check(path); continue; }
    if (/^\.env|\.(pem|key|p12|tfstate|log)$|^(credentials|service-account).*\.json$/.test(entry.name)) findings.push(name + ': blocked file');
    const bytes = await readFile(path);
    if (bytes.length > 5_000_000) findings.push(name + ': oversized asset');
    if (/\.(png|jpg)$/.test(name)) continue;
    const text = bytes.toString('utf8');
    if (patterns.some(pattern => pattern.test(text))) findings.push(name + ': credential or private identifier pattern');
    if (terms.some(term => text.toLowerCase().includes(term.toLowerCase()))) findings.push(name + ': private term');
    if (!name.endsWith('.md')) continue;
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(target)) continue;
      const file = resolve(dirname(path), target.split('#')[0]);
      if (relative(root, file).startsWith('..')) { findings.push(name + ': reference outside repository'); continue; }
      try { await access(file); } catch { findings.push(name + ': missing reference ' + target); }
    }
  }
}
await check(root);
if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
else console.log('Documentation references and publication patterns passed. Screenshots still require visual review.');

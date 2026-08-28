/**
 * Pre-commit safety scan: look for secret-shaped content in the text files git is about
 * to record. Read-only, and it stages nothing.
 *
 * Reads the list of paths on stdin, one per line, so the caller decides the scope.
 * Binary and evidence artefacts are skipped: they are screenshots and archives, and a
 * false positive on a JPEG's entropy tells nobody anything.
 */
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  [/\bapi[_-]?key\s*[:=]\s*['"][^'"]{12,}/i, 'api key assignment'],
  [/\baccess[_-]?token\s*[:=]\s*['"][^'"]{12,}/i, 'access token assignment'],
  [/-----BEGIN (RSA|OPENSSH|EC|DSA|PGP)? ?PRIVATE KEY-----/, 'private key block'],
  [/\bnpm_[A-Za-z0-9]{36}/, 'npm token'],
  [/\bghp_[A-Za-z0-9]{36}/, 'github token'],
  [/\bgho_[A-Za-z0-9]{36}/, 'github oauth token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'aws access key id'],
  [/\bBearer\s+[A-Za-z0-9._-]{24,}/, 'bearer token'],
  [/\bpassword\s*[:=]\s*['"][^'"]{6,}/i, 'password assignment'],
];

const SKIP_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico', '.svg',
  '.zip', '.gz', '.tgz', '.woff', '.woff2', '.ttf', '.pdf', '.mp4', '.mov',
]);

const paths = readFileSync(0, 'utf8').split('\n').filter(Boolean);
let scanned = 0;
let hits = 0;

for (const path of paths) {
  const lower = path.toLowerCase();
  if ([...SKIP_EXT].some((ext) => lower.endsWith(ext))) continue;
  if (lower.includes('.evidence/')) continue;
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    continue;
  }
  if (size > 2_000_000) continue;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  scanned += 1;
  const lines = text.split('\n');
  for (const [pattern, label] of PATTERNS) {
    for (let i = 0; i < lines.length; i += 1) {
      if (!pattern.test(lines[i])) continue;
      hits += 1;
      console.log(`  ${label}  ${path}:${i + 1}`);
      console.log(`    ${lines[i].trim().slice(0, 110)}`);
      break;
    }
  }
}

console.log('');
console.log(`text files scanned : ${scanned}`);
console.log(`secret-shaped hits : ${hits}`);
process.exitCode = hits === 0 ? 0 : 1;

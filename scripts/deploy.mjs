// Publish the game to the web host over FTP (with TLS), replacing the
// manual zip-upload-and-extract in cPanel. Only what the site needs is
// sent: .htaccess (cache headers), index.html, manifest.json, css/ and js/.
//
// Credentials come from the environment or from .env.deploy (gitignored):
//   LANDER_FTP_USER   FTP account, e.g. lander@thaeler.net
//   LANDER_FTP_PASS   its password
//   LANDER_FTP_HOST   default cpanel306.turbify.biz -- the server's own name,
//                     which is what its TLS certificate is issued for
//   LANDER_FTP_DIR    remote folder, e.g. /lander. Required: an account can
//                     open on the main site's root, and an index.html there
//                     would replace the thaeler.net homepage.
//
// Usage: npm run deploy            upload everything
//        npm run deploy -- --dry   list what would be uploaded

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLISH = ['.htaccess', 'index.html', 'manifest.json', 'css', 'js'];

function loadEnvFile() {
  const file = join(ROOT, '.env.deploy');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function filesUnder(path) {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => filesUnder(join(path, name)));
}

loadEnvFile();
const dry = process.argv.includes('--dry');
const files = PUBLISH.flatMap(filesUnder).map((f) => relative('.', f));
const host = process.env.LANDER_FTP_HOST || 'cpanel306.turbify.biz';
const rawDir = (process.env.LANDER_FTP_DIR || '').trim();
if (!rawDir || rawDir === '/') {
  console.error('Set LANDER_FTP_DIR to the game\'s own folder, e.g. /lander (never the site root).');
  process.exit(1);
}
const dir = rawDir.replace(/^\/?/, '/').replace(/\/?$/, '/');

if (dry) {
  for (const f of files) console.log(`  ftp://${host}${dir}${f}`);
  process.exit(0);
}

const { LANDER_FTP_USER: user, LANDER_FTP_PASS: pass } = process.env;
if (!user || !pass) {
  console.error('Set LANDER_FTP_USER and LANDER_FTP_PASS (or put them in .env.deploy).');
  process.exit(1);
}

// One curl run per file: run as a batch, curl's exit code reflects only the
// last transfer, so a failed upload in the middle went unreported. The
// config goes in on stdin so the password never appears in a process list.
const quote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function upload(file) {
  const config = [
    `user = ${quote(`${user}:${pass}`)}`,
    'ssl-reqd',
    'ftp-create-dirs',
    'silent',
    'show-error',
    'max-time = 60',
    `upload-file = ${quote(join(ROOT, file))}`,
    `url = ${quote(`ftp://${host}${dir}${file}`)}`,
  ].join('\n');
  return new Promise((resolve) => {
    const curl = spawn('curl', ['--config', '-'], { stdio: ['pipe', 'inherit', 'inherit'] });
    curl.stdin.end(config);
    curl.on('close', resolve);
  });
}

console.log(`Uploading ${files.length} files to ftp://${host}${dir} ...`);
const failed = [];
for (const f of files) {
  const code = await upload(f);
  console.log(`  ${code === 0 ? 'ok    ' : 'FAILED'}  ${f}`);
  if (code !== 0) failed.push(f);
}
if (failed.length) {
  console.error(`\n${failed.length} upload(s) failed: ${failed.join(', ')}`);
  console.error('Those files may now be empty on the server.');
  process.exit(1);
}
console.log('Done.');

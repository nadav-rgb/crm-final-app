// scripts/dev-local.js — runs the local dev server with Node trusting the OS certificate store.
//
// WHY: this machine runs the Techloq content filter, which does TLS interception — external HTTPS
// (e.g. Supabase) is re-signed by the "techloq-CA" root. The browser trusts that root (installed in
// the Windows store), so client-side Supabase calls work. But Node uses its own bundled Mozilla CA
// list by default and does NOT trust techloq-CA, so every SERVER-side call in an API route
// (admin.auth.getUser, writes) failed with UNABLE_TO_GET_ISSUER_CERT_LOCALLY → 401.
//
// --use-system-ca (Node 22+) makes Node ALSO trust the OS root store, matching the browser. It does
// NOT weaken verification (unlike NODE_TLS_REJECT_UNAUTHORIZED=0) — the chain is still fully checked.
// Local dev only; production (Vercel) sees real certs and never loads this script.
const { spawn } = require('child_process');
const path = require('path');

const port = process.argv[2] || '3010';
const nodeOptions = [process.env.NODE_OPTIONS, '--use-system-ca'].filter(Boolean).join(' ');

const child = spawn('npx', ['next', 'dev', '-p', port], {
  stdio: 'inherit',
  shell: true,
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
child.on('exit', code => process.exit(code ?? 0));

import { NextResponse } from 'next/server.js';

const NONCE = /^[A-Za-z0-9+/_-]{16,128}={0,2}$/;

export function createNonce(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.getRandomValues) throw new Error('Secure randomness is unavailable');
  const bytes = new Uint8Array(18);
  cryptoProvider.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy(nonce, { production = false } = {}) {
  if (!NONCE.test(nonce)) throw new Error('Invalid CSP nonce');
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (production) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function securityHeaderEntries(nonce, { production = false } = {}) {
  return [
    ['Content-Security-Policy', buildContentSecurityPolicy(nonce, { production })],
    ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), geolocation=(), payment=(), microphone=(self)'],
    ['X-Frame-Options', 'DENY'],
    ['Cache-Control', 'no-store, private'],
  ];
}

export function middleware(request) {
  const nonce = createNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of securityHeaderEntries(nonce, {
    production: process.env.NODE_ENV === 'production',
  })) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

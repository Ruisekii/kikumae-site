import { NextResponse } from 'next/server';

const SECURITY_HEADERS: Array<[string, string]> = [
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data: https://quickchart.io; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"],
];

export function proxy(): Response {
  const response = NextResponse.next();
  for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: '/:path*',
};

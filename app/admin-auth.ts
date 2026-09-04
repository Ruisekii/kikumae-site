import { cookies } from 'next/headers';
import { env } from 'cloudflare:workers';

const ADMIN_COOKIE = 'kikumae_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;
// 管理者パスワードの最小文字数。これを下回る設定値は「未設定」として扱い、ログインを一切通さない。
const MIN_PASSWORD_LENGTH = 8;
const encoder = new TextEncoder();

export type AdminSession = {
  userId: string;
  displayName: string;
  expiresAt: number;
};

function configuredPassword(): string {
  return env.KIKUMAE_ADMIN_PASSWORD?.trim() ?? '';
}

async function importHmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const secret = configuredPassword();
  if (!secret || secret.length < MIN_PASSWORD_LENGTH || !password || password.length > 128) return false;
  const key = await importHmacKey('kikumae-admin-password-check', ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(secret)));
  const actual = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(password)));
  if (expected.length !== actual.length) return false;
  let difference = 0;
  expected.forEach((byte, index) => { difference |= byte ^ actual[index]; });
  return difference === 0;
}

export async function createAdminSessionCookie(): Promise<string> {
  const secret = configuredPassword();
  if (!secret || secret.length < MIN_PASSWORD_LENGTH) throw new Error('ADMIN_PASSWORD_NOT_CONFIGURED');
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const payload = `v1.${expiresAt}.${crypto.randomUUID()}`;
  const signature = await sign(payload, secret);
  return `${ADMIN_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearAdminSessionCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const secret = configuredPassword();
  if (!secret || secret.length < MIN_PASSWORD_LENGTH) return null;
  const stored = (await cookies()).get(ADMIN_COOKIE)?.value ?? '';
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const payload = parts.slice(0, 3).join('.');
  const expiresAt = Number(parts[1]);
  const signature = fromBase64Url(parts[3]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !signature) return null;
  const key = await importHmacKey(secret, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(payload));
  return valid ? { userId: 'admin-password', displayName: '避難所管理者', expiresAt } : null;
}

export async function getAdminUser(): Promise<{ userId: string; displayName: string } | null> {
  const session = await getAdminSession();
  return session ? { userId: session.userId, displayName: session.displayName } : null;
}

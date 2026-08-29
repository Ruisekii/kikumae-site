import { getPortal, getPortalBySession, type Portal } from './portals';

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return null; }
}

export function portalSessionToken(request: Request): string | null {
  return cookieValue(request, 'kikumae_portal_session');
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function requirePortalSession(request: Request, slug: string): Promise<Portal | null> {
  const portal = await getPortal(slug);
  if (!portal) return null;
  const session = portalSessionToken(request);
  if (!session) return null;
  const sessionPortal = await getPortalBySession(session);
  return sessionPortal?.id === portal.id ? sessionPortal : null;
}

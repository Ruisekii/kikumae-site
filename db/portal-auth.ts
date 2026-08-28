import { getPortal, getPortalBySession, type Portal } from './portals';

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function requirePortalSession(request: Request, slug: string): Promise<Portal | null> {
  const portal = await getPortal(slug);
  if (!portal) return null;
  const session = cookieValue(request, 'kikumae_portal_session');
  if (!session) return null;
  const sessionPortal = await getPortalBySession(session);
  return sessionPortal?.id === portal.id ? sessionPortal : null;
}

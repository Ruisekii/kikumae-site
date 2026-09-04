import { clearAdminSessionCookie } from '../../admin-auth';

export const runtime = 'edge';

export async function GET(request: Request): Promise<Response> {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL('/admin', request.url).toString(),
      'Set-Cookie': clearAdminSessionCookie(),
      'Cache-Control': 'no-store',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';

/**
 * Temporary shared-access gate for the hackathon demo.
 * It is deliberately NOT an account system and issues no permanent sessions.
 * Remove it only after authenticated/scoped API routes are implemented.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();

  const password = process.env.SIKHAL_DEMO_PASSWORD;
  if (!password || password.length < 16) {
    return new NextResponse('Demo access is not configured.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const header = request.headers.get('authorization') ?? '';
  let valid = false;
  if (header.startsWith('Basic ')) {
    try {
      const credentials = atob(header.slice(6));
      const divider = credentials.indexOf(':');
      const username = credentials.slice(0, divider);
      const supplied = credentials.slice(divider + 1);
      // Equal-length constant-work comparison for the passcode.
      if (divider >= 0 && username === 'demo' && supplied.length === password.length) {
        let mismatch = 0;
        for (let i = 0; i < password.length; i++) {
          mismatch |= supplied.charCodeAt(i) ^ password.charCodeAt(i);
        }
        valid = mismatch === 0;
      }
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    return new NextResponse('SikHal demo access required.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="SikHal Demo", charset="UTF-8"',
        'Cache-Control': 'no-store',
      },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};

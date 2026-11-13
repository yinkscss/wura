import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/server/session";

// Optimistic route guard. The API re-checks the session on every call.
const PROTECTED = ["/wallet", "/chat", "/activity", "/limits", "/channels", "/settings", "/onboarding"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/wallet/:path*",
    "/chat/:path*",
    "/activity/:path*",
    "/limits/:path*",
    "/channels/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
};

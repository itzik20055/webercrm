import { NextResponse, type NextRequest } from "next/server";
import { unsealData } from "iron-session";
import type { AppSession } from "@/lib/session";

const SESSION_COOKIE = "weber_session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/cron/")) {
    const auth = req.headers.get("authorization");
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    return NextResponse.next();
  }

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons/")
  ) {
    return NextResponse.next();
  }

  const password = process.env.SESSION_SECRET;
  if (!password) {
    return new NextResponse("SESSION_SECRET missing", { status: 500 });
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  let authed = false;
  if (cookie) {
    try {
      const session = await unsealData<AppSession>(cookie, { password });
      authed = session.authenticated === true;
    } catch {
      authed = false;
    }
  }

  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};

import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname === "/matches/new";

  if (!isAdminRoute) return NextResponse.next();
  if (request.cookies.has("sifup_session")) return NextResponse.next();

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/matches/new"],
};

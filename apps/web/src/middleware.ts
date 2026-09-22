/**
 * The language in the URL.
 *
 * Every page lives under src/app/[lang]/, and a bare path is English: /quests is served by
 * /enUS/quests without the browser ever seeing the prefix. That keeps every address that
 * existed before languages did -- bookmarks, the addons' Report links, search results -- and
 * gives each page one canonical URL per language, so /enUS/quests is sent back to /quests
 * rather than being a second address for the same thing.
 *
 * VALIDATED AGAINST THE LIST IN CODE, NOT THE DATABASE. This runs in front of every page
 * view and must not put a query there. Whether a language is switched on is the layout's
 * question (src/app/[lang]/layout.tsx), asked only for a language other than English, so
 * English pages keep rendering without a database round trip. A path that merely looks like
 * a language -- /xxYY/quests -- is not one, and is rewritten like any other bare path, onto
 * a page that does not exist.
 */
import { NextResponse, type NextRequest } from "next/server";

import { BASE_LANG, isLang } from "@/lib/lang";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1];

  if (isLang(first)) {
    if (first !== BASE_LANG) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(1 + BASE_LANG.length) || "/";
    url.search = search;
    return NextResponse.redirect(url, 308);
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${BASE_LANG}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Not the API, which takes its language as ?lang= (lib/lang.ts withLang); not Next's own
  // assets; not /downloads, which nginx serves from disk; and not a file -- /logo.png,
  // /favicon.ico, /icons/... -- which a rewrite would send to /enUS/logo.png and a 404.
  matcher: ["/((?!api/|_next/|downloads/|.*\\..*).*)"],
};

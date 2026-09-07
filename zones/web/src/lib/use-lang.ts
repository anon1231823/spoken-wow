"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { BASE_LANG, isLang, type Lang } from "@/lib/lang";

/**
 * Which language the page is being read in, taken from the first path segment.
 *
 * THE URL IS THE STATE. Nothing is stored, so there is nothing to keep in step: the
 * address bar says which language you are looking at, a pasted link shows the recipient
 * what it showed the sender, and the back button undoes a language change like any other
 * navigation. Switching is a client-side navigation, so it applies immediately -- an
 * earlier version kept the choice in a cookie, and the explorer went on showing the old
 * language until something happened to refetch.
 *
 * Derived rather than passed down: the root layout sits above the [lang] segment and
 * cannot see the parameter, and reading it here keeps that layout static.
 *
 * `hasLang` is false on the pages that mean the same thing in every language -- settings,
 * the user table, sign-in. They live outside the segment, and the switch hides itself
 * there rather than offering a change with nowhere to apply it.
 */
export function useLang(): {
  lang: Lang;
  hasLang: boolean;
  setLang: (lang: Lang) => void;
} {
  const router = useRouter();
  const pathname = usePathname();

  const [lang, hasLang] = useMemo(() => {
    const first = pathname.split("/")[1];
    return isLang(first) ? ([first, true] as const) : ([BASE_LANG, false] as const);
  }, [pathname]);

  const setLang = useCallback(
    (next: Lang) => {
      if (!hasLang) return;
      // The rest of the path is the same page in another language, so only the segment
      // moves. push, not replace: the language you were reading is somewhere the back
      // button should return to.
      const rest = pathname.split("/").slice(2).join("/");
      // The query survives too -- the filters, the page and the search box all live
      // there, and a language switch is a change of language, not of what you were
      // looking for.
      //
      // Read from the location at click time rather than through useSearchParams,
      // which opts every component calling it into client-side rendering and would
      // therefore demand a Suspense boundary around the whole header, on every page.
      const query = window.location.search;
      router.push(`/${next}${rest ? `/${rest}` : ""}${query}`);
    },
    [hasLang, pathname, router],
  );

  return { lang, hasLang, setLang };
}

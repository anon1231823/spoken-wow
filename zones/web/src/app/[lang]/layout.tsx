import { notFound } from "next/navigation";

import { CODES, isLang } from "@/lib/lang";

/**
 * The language segment every page that has one sits under: /enUS, /deDE/feedback,
 * /esMX/r/1411/razor-hill.
 *
 * IN THE PATH RATHER THAN A COOKIE OR A QUERY PARAMETER. The language decides what
 * the page says, so it belongs in the page's address: a link someone pastes into
 * chat shows them what it showed the sender, the back button walks through language
 * changes like any other navigation, and switching is a normal client-side
 * navigation rather than a state change the server has to be told about separately.
 *
 * Pages that mean the same thing in every language -- the account settings, the user
 * table, sign-in -- deliberately stay outside it. A /deDE/admin that rendered exactly
 * /enUS/admin would be two addresses for one page and a language switch that appeared
 * to do nothing.
 *
 * An unknown code is a 404 rather than a redirect to English: /xxYY/feedback is not a
 * page with a bad setting, it is not a page at all, and silently serving English would
 * hide a broken link in whatever produced it.
 */
export function generateStaticParams() {
  return CODES.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return children;
}

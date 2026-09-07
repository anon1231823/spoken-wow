"use client";

import { messages } from "@/lib/messages";
import { useLang } from "@/lib/use-lang";

/**
 * The words on the /r/ not-found page, in the language of the URL.
 *
 * A client component because not-found.tsx receives no params: the language is only
 * knowable from the path, and useLang reads it there. `part` selects which piece,
 * so the page keeps its own layout around the link.
 */
export function NotFoundText({ part = "body" }: { part?: "body" | "browse" }) {
  const t = messages(useLang().lang);
  if (part === "browse") return <>{t("notFound.browse")}</>;
  return (
    <>
      <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
      <p className="mt-2 text-muted">{t("notFound.body")}</p>
    </>
  );
}

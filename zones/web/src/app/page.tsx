import { redirect } from "next/navigation";

import { BASE_LANG } from "@/lib/lang";

// Every page that depends on the language lives under one (/enUS, /deDE, ...). The
// bare paths stay working and send you to English: they are what every existing link
// says -- shared URLs, the addon's Report button, anything already bookmarked -- and
// English is what all of them meant when they were written.
export default function Page() {
  redirect(`/${BASE_LANG}`);
}

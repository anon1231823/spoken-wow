import { redirect } from "next/navigation";

/**
 * The front door, which is the quests explorer until there are two of them.
 *
 * A landing page with two links is what this becomes, and it would be a landing page with
 * one live link and one dead one today. A redirect says the same thing without the dead
 * link, and turning it into the real page is a file that replaces this one.
 */
export default function Page() {
  redirect("/quests");
}

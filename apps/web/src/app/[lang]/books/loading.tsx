import { Loading } from "@/components/Loading";

/** Shown while the server renders the page: its filter options come from the database. */
export default function PageLoading() {
  return (
    <main className="mx-auto max-w-6xl px-5 pt-6 pb-36">
      <Loading label="Loading pages…" />
    </main>
  );
}

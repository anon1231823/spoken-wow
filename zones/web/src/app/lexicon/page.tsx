import { redirect } from "next/navigation";

// The pronunciation editor moved out. The lexicon proper always lived in
// wow-voiceover, which owns the dictionary both projects share on one ElevenLabs
// account; the respelling escape hatch this page carried was never used and kept a
// second editor alive for an empty file. Old bookmarks land on the real one.
export default function Page() {
  redirect("https://voiceover.rusty.one/pronunciation");
}

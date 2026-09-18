import { test } from "node:test";
import assert from "node:assert/strict";

import { booksLua } from "./lua.mjs";
import { pageChecksum } from "./naming.mjs";

const entries = [
  { pageId: 10, bookId: 10, pageNumber: 1, pageCount: 2, title: "A Dusty Tome", text: "One." },
  { pageId: 11, bookId: 10, pageNumber: 2, pageCount: 2, title: "A Dusty Tome", text: "Two." },
  { pageId: 20, bookId: 20, pageNumber: 1, pageCount: 1, title: "A Note", text: "Three." },
];

test("the header says the file is generated", () => {
  assert.match(booksLua(entries), /AUTO-GENERATED[\s\S]*Do not edit by hand/);
});

test("a page is indexed by title, number and checksum", () => {
  const lua = booksLua(entries);
  assert.ok(lua.includes(`["A Dusty Tome"]`));
  assert.ok(lua.includes(`[${pageChecksum("One.")}] = 10`));
});

test("a page records which book it belongs to and where", () => {
  assert.match(booksLua(entries), /\[11\] = \{ book = 10, number = 2 \}/);
});

test("a book lists its pages in reading order", () => {
  assert.match(booksLua(entries), /\[10\] = \{ title = "A Dusty Tome", pages = \{ 10, 11 \} \}/);
});

test("a unique checksum is reachable without the title", () => {
  assert.match(booksLua(entries), new RegExp(`\\[${pageChecksum("Three.")}\\] = 20`));
});

test("a checksum shared by two pages is left out of the loose index", () => {
  // Reachable by title and page number, never by checksum alone: a fallback that can
  // return the wrong page reads the wrong words aloud, which is worse than staying quiet.
  const shared = [
    { pageId: 1, bookId: 1, pageNumber: 1, pageCount: 1, title: "Ledger", text: "..." },
    { pageId: 2, bookId: 2, pageNumber: 1, pageCount: 1, title: "Tally", text: "..." },
  ];
  const lua = booksLua(shared);
  const loose = lua.slice(lua.indexOf("loose = {"), lua.indexOf("pages = {"));
  assert.ok(!loose.includes(String(pageChecksum("..."))), "the ambiguous checksum is absent");
});

test("a quote in a title is escaped", () => {
  const lua = booksLua([
    { pageId: 1, bookId: 1, pageNumber: 1, pageCount: 1, title: 'The "Book"', text: "x" },
  ]);
  assert.ok(lua.includes('["The \\"Book\\""]'));
});

test("the output is sorted, so a re-export diffs only where the corpus moved", () => {
  const shuffled = [entries[2], entries[1], entries[0]];
  assert.equal(booksLua(shuffled), booksLua(entries));
});

test("pages that are indistinguishable on screen resolve to the lowest book, deterministically", () => {
  // "Inscribed Kodo Leather" is four different books holding identical text. Nothing on
  // screen tells them apart -- same title, same page number, same words -- so the addon
  // cannot either, and the narration is the same whichever it picks. What matters is that
  // it picks the same one every time rather than whichever row was written last.
  const identical = [
    { pageId: 40, bookId: 40, pageNumber: 1, pageCount: 1, title: "Inscribed Kodo Leather", text: "Same." },
    { pageId: 30, bookId: 30, pageNumber: 1, pageCount: 1, title: "Inscribed Kodo Leather", text: "Same." },
  ];
  const lua = booksLua(identical);
  assert.match(lua, new RegExp(`\\[1\\] = \\{ \\[${pageChecksum("Same.")}\\] = 30 \\}`));
});

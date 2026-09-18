import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBooks } from "./chains.mjs";

const pages = [
  { entry: 10, text: "Page one.", nextPage: 11 },
  { entry: 11, text: "Page two.", nextPage: 12 },
  { entry: 12, text: "Page three.", nextPage: 0 },
  { entry: 20, text: "A note.", nextPage: 0 },
  { entry: 99, text: "Nobody owns this.", nextPage: 0 },
];

const owners = [
  { kind: "object", id: 179547, name: "A Dusty Tome", firstPage: 10, material: 0 },
  { kind: "item", id: 2794, name: "Stalvan's Note", firstPage: 20, material: 2 },
];

test("a chain becomes one entry per page, numbered in reading order", () => {
  const { entries } = buildBooks({ pages, owners });
  const chain = entries.filter((e) => e.bookId === 10);
  assert.deepEqual(chain.map((e) => e.pageNumber), [1, 2, 3]);
  assert.deepEqual(chain.map((e) => e.pageId), [10, 11, 12]);
  assert.deepEqual(chain.map((e) => e.pageCount), [3, 3, 3]);
});

test("every page of a chain carries the owner's title and material", () => {
  const { entries } = buildBooks({ pages, owners });
  const last = entries.find((e) => e.pageId === 12);
  assert.equal(last.title, "A Dusty Tome");
  assert.equal(last.ownerKind, "object");
  assert.deepEqual(last.ownerIds, [179547]);
  assert.equal(last.material, 0);
});

test("the line id and file are the frozen ones", () => {
  const { entries } = buildBooks({ pages, owners });
  const first = entries.find((e) => e.pageId === 10);
  assert.equal(first.lineId, "b:10");
  assert.equal(first.file, "10");
});

test("an item owner gives ownerKind 'item'", () => {
  const { entries } = buildBooks({ pages, owners });
  assert.equal(entries.find((e) => e.pageId === 20).ownerKind, "item");
});

test("a page no owner reaches is reported as an orphan, not emitted", () => {
  const { entries, orphans } = buildBooks({ pages, owners });
  assert.deepEqual(orphans, [99]);
  assert.equal(entries.find((e) => e.pageId === 99), undefined);
});

test("two owners of one chain both ride along, sorted, on every page", () => {
  const shared = [
    ...owners,
    { kind: "object", id: 179548, name: "A Dusty Tome", firstPage: 10, material: 0 },
  ];
  const { entries } = buildBooks({ pages, owners: shared });
  assert.deepEqual(entries.find((e) => e.pageId === 10).ownerIds, [179547, 179548]);
  assert.deepEqual(entries.find((e) => e.pageId === 12).ownerIds, [179547, 179548]);
});

test("a cyclic next_page terminates instead of hanging", () => {
  const cyclic = [
    { entry: 30, text: "One.", nextPage: 31 },
    { entry: 31, text: "Two.", nextPage: 30 },
  ];
  const { entries } = buildBooks({
    pages: cyclic,
    owners: [{ kind: "object", id: 1, name: "Loop", firstPage: 30, material: 0 }],
  });
  assert.deepEqual(entries.map((e) => e.pageId), [30, 31]);
});

test("text, spoken text and voiceability come along per page", () => {
  const { entries } = buildBooks({
    pages: [{ entry: 40, text: "Greetings, $N.", nextPage: 0 }],
    owners: [{ kind: "item", id: 7, name: "Summons", firstPage: 40, material: 1 }],
  });
  assert.equal(entries[0].generatable, false);
  assert.equal(entries[0].skipReason, "substitution");
});

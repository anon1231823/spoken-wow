# One-off scripts

Each folder here is a change to production's data that ran **once**, kept so that anyone
reading the history can see exactly what was done and why. A folder is named for the month it
ran and what it did.

These are records, not tools:

- **Never run one again.** Each was written for the data as it stood on the day, and assumes
  it. Running one twice, or against a later schema, is at best a no-op and at worst damage.
- **Never maintain one.** Nothing imports from here, and nothing here is in any test or
  typecheck. When the code around them changes — a table is renamed, a helper moves, a path
  changes — leave these as they are. They are not outdated code waiting for a refactor; they
  describe a past that does not change.
- **Never import from one.** If a later change needs the same logic, copy it and own it.

A folder can be deleted once nobody needs to read it. Its commits stay in git either way.

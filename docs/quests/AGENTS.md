This file provides guidance to agents when working with code in this repository.

## Conventions

- Keep code simple — avoid over-engineering
- One module per concern

### Code Comments

1. **Explain the *why*, not the *what*** — The code shows what it does; comments must explain the reasoning, intent, or context behind it.
2. **Never comment obvious code** — If the code is self-explanatory, do not add a comment. Noise is worse than silence.
3. **Prefer readable code over comments** — If a comment is needed to explain unclear code, refactor the code first (better naming, smaller functions, simpler logic).
4. **Never leave commented-out code** — Remove it. Version control preserves history.
5. **Be concise** — One clear sentence is better than a paragraph. Avoid filler phrases like "This function basically just...".
6. **Keep comments in sync with code** — When code changes, update or delete its comments immediately. A stale comment is a bug.
7. **Write for a competent developer with no prior context** — Assume they understand code but not your specific decisions.
8. **Use full sentences for block comments** — Avoid abbreviations or internal jargon unless universally understood.

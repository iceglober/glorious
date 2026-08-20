---
"@glrs-dev/glrs": patch
---

Repository writing rules, and glrs stops printing em-dashes.

`AGENTS.md` now sits at the repository root, which means `guidance.ts` loads it into the model's system prompt as `<repo-rules>`. glrs follows these rules when it works on itself.

Three rules: examples over explanations, no em-dashes anywhere, and progressive disclosure for heavy material.

The second one applies to output, not only to prose about output, so twelve user-facing strings changed:

```
before   glrs — a terminal coding agent
after    glrs: a terminal coding agent

before   (step limit reached — send "continue" to resume)
after    (step limit reached: send "continue" to resume)

before   A: rewrite it — with tests
after    A: rewrite it (with tests)
```

Each mark was chosen for what the dash was standing in for. A colon where the second half explains the first, a comma where the clause is parenthetical, a full stop where it can stand alone, parentheses where the aside is genuinely an aside.

The published documentation quotes glrs's output in about a dozen places, so those samples were regenerated against the running binary rather than edited to look right.

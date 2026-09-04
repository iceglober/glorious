---
"@glrs-dev/glrs": minor
---

Named tiers of model, resolved against the providers you have credentials for.

A tier is a name for the model you want for a kind of work, and a list of candidates in preference order. The first one glrs has credentials for wins:

```json
{
  "extensions": {
    "settings": {
      "tiers": {
        "default": "balanced",
        "fast": ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-mini"],
        "balanced": ["anthropic/claude-opus-5", "azure/gpt-5.6-sol"],
        "deep": [{ "model": "anthropic/claude-opus-5", "variant": "high" }]
      }
    }
  }
}
```

```
/tier              list them, and what each resolves to
/tier deep         switch
```

**glrs ships no tiers and no opinion about which model belongs in which.** A table saying `medium = opus-5` is wrong the month a new model lands. Because the names are yours, they need not avoid `low`, `medium` and `high`, which already mean reasoning effort everywhere else.

`default` names the tier used when a session opens with no model. It resolves before the picker opens, so the ordinary path is that you never see the picker. `-p` is not covered: it resolves its model before extensions load.

**Extensions can have config now.** `extensions.settings` is a block keyed by extension name, merged across the three scopes as JSON, and `g.config()` hands an extension its own and no other. glrs never reads inside, so the shape belongs to whoever wrote the extension. `tiers` is the first user of it.

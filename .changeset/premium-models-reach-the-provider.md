---
"web": patch
---

Asking for a premium or a fast model now gets you that model. On the OpenRouter
and Vercel Gateway paths, every current Anthropic model id except Sonnet was
missing from the translation table, so a request for Opus, Haiku or the deep
tier silently resolved to the default chat model instead. Nothing failed and
nothing warned — the reply simply came back from a different model than the one
that was asked for, at whatever quality that model happens to give.

Two ids that name no real model were removed from the same table at the same
time. They had been mapping onto retired upstream models.

A coverage test now derives the id list from the model registry and the backend
list from the provider registry, so a model id added to the app, or a chat
backend added to the registry, is checked on the day it lands rather than the
day someone remembers this table exists.

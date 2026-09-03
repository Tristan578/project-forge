---
"web": patch
---

Chat requests routed through the Vercel AI Gateway now carry an ordered model fallback list (premium → chat → fast) and `caching: 'auto'`, so a provider outage degrades to the next model instead of failing the request, and repeated prompt prefixes are cached where the provider supports it.

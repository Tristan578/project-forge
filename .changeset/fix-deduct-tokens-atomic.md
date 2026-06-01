---
"web": patch
---

fix(tokens): deductTokens now performs the balance deduction and the usage-record insert in a single atomic CTE. Previously the two ran as separate statements, so a usage INSERT that failed after the balance UPDATE committed would charge a user with no token_usage row and no returned usageId — leaving the failed generation's refund path unable to run. The deduction, the usage row, and the returned usageId are now all-or-nothing (PF-839, #8663).

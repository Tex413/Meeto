---
title: Why are no insight cards appearing?
product: Meeteor
version: 2.1.0
tags: [troubleshooting, cards, ai]
applies_to: Insight cards panel
---

## Short answer
Cards need active listening, a working AI key and at least 12 new words at each analysis. The AI can also decide that nothing is worth a card.

## Steps
1. Check that you selected **Start listening** and that words appear in **Live transcript**.
2. Wait for the **Analysis in … s** countdown to finish, and keep talking until there are at least 12 new words.
3. Open **Settings** and confirm **✓ Key saved** for the selected provider.
4. Open **Debug log** and select **Test AI**.
5. Check the log for **Analysis skipped** or **no cards generated**.
6. Clear **Filter cards…**, which may be hiding cards, and check whether **Auto-clear** faded them.
7. Adding relevant **Context** or documents gives the AI more to work with.

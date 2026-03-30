# Session Log: Lit HTML vs React — Friction Research Follow-up

**Date:** 2026-03-17 13:36  
**Participants:** Mal (Architect), Wash (Frontend Developer)  
**Requested by:** Marek Fišera  
**Topic:** Follow-up friction evaluation after initial Lit vs React architectural decision  

## Context

Initial Lit vs React evaluation (2026-03-17 morning) resulted in split verdict: Mal recommended Lit, Wash recommended React. Marek asked both agents to dig deeper into specific friction points to converge the recommendation.

## Work Done

**Mal:** Researched current state of Lit routing (Vaadin deprecated), Tailwind + Shadow DOM integration, testing ecosystem, and SignalR examples.

**Wash:** Verified Tailwind friction, assessed Lit testing landscape (Vitest, Playwright, @open-wc/testing), evaluated routing options, and downgraded severity of original objections.

## Key Findings

1. **Routing:** Vaadin Router officially deprecated; `@lit-labs/router` still experimental. Custom router feasible for SharedSpaces' 3 routes but adds work.
2. **Tailwind:** Works with Lit via light DOM, CSS injection, or token-based styling. Not a dealbreaker, just a trade-off.
3. **Testing:** Gap has narrowed. Vitest Browser Mode + Playwright + @open-wc/testing is credible.
4. **SignalR:** Framework-agnostic JS client. React wins on example ecosystem, not capability.

## Outcome

**Both agents converge: React is the recommendation for SharedSpaces SPA.**

- Mal revised from "switch to Lit" → "stay with React"
- Wash softened from "dealbreaker" → "viable but not worth the friction"
- Routing remains the weak point in Lit story
- All other concerns are manageable trade-offs, not blockers

## Decision Status

Pending Marek's choice, but team has now reached alignment. Both evaluations include rationale, risk assessments, and implementation guardrails if Lit is chosen for future isolated components.

---

**Artifacts:**
- `.squad/decisions/inbox/mal-friction-response.md`
- `.squad/decisions/inbox/wash-friction-research.md`

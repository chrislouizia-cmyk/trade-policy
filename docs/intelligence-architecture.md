# Trade Police Intelligence architecture

## Decision authority

The deterministic Sprint A Decision Engine is the sole authority for trading decisions. It owns evidence evaluation, automatic/manual rule separation, risk calculations, strategy thresholds, vetoes, daily controls, and the final `AUTHORIZED`, `WAIT`, or `REJECTED` verdict.

The Intelligence layer runs only after that verdict exists. It cannot feed information back into the engine or change the engine input or output.

```text
validated request + active strategy + daily context
                       |
                       v
          deterministic Decision Engine
                       |
          AUTHORIZED / WAIT / REJECTED
                       |
                       v
      deterministic Decision Narrative builder
                       |
          immutable operational narrative
                       |
                       v
       optional coaching-only AI enhancement
                       |
                       v
        additive decisionNarrative response
```

The public mapping is exact and must not be inferred by AI:

| Engine verdict | Narrative recommendation |
| --- | --- |
| `AUTHORIZED` | `ENTER` |
| `WAIT` | `WAIT` |
| `REJECTED` | `BLOCK` |

`ENTER` means that configured deterministic conditions passed. It is not a promise or probability of profit.

## Post-validation flow

`POST /api/validate` authenticates the user, validates its request, loads the active strategy and daily context, rejects confirmations for rules that are not configured as manual, applies valid manual confirmations, and executes the deterministic engine.

After the final `TradeResult` exists, the route builds a deterministic `DecisionNarrative`. That narrative is the operational read model returned to consumers. An optional server-side coaching call may then attach educational fields. AI failure never removes the deterministic narrative.

The existing validation response remains intact. `decisionNarrative` is an additive sibling of the existing result, strategy reference, and manual confirmations.

## Deterministic narrative ownership

The deterministic layer exclusively owns:

- `recommendation` and `engineVerdict`;
- headline and operational explanation;
- reason identities, statuses, blocking flags, categories, and messages;
- missing-evidence identities, modes, wording, and confirmability;
- next-action identities, types, labels, rationales, ordering, and blocking flags;
- strategy context and risk-policy summary;
- evidence-readiness values and wording;
- discipline message;
- narrative timestamp and contract version.

The AI layer receives these fields only as immutable, read-only context.

## Coaching-only AI contract

AI may return only:

- `educationalExplanation`;
- `coachingMessage`;
- `learningTip`.

These fields are optional. Their absence must not affect the verdict, narrative, or usability of validation.

AI can never modify or replace:

- verdict or recommendation;
- headline or deterministic explanation;
- reason or evidence wording;
- reason status or blocking state;
- missing evidence or evaluation mode;
- manual-confirmation state;
- next-action type, label, rationale, or priority;
- readiness score or strategy threshold;
- strategy or risk constraints.

The server accepts coaching only when it matches the strict three-field JSON schema and passes semantic-safety checks. Any extra property, operational instruction, verdict language, evidence interpretation, readiness claim, profit claim, markup, or unknown vocabulary causes deterministic fallback.

## Automatic and manual evidence

`evaluation_mode` remains a strategy and engine concern.

- Automatic evidence is determined by the analysis/engine path and is never user-confirmable in the narrative.
- Manual evidence is confirmable only when an enabled strategy rule is explicitly configured as `MANUAL`.
- Manual rules are never described as automatically detected unless the authoritative engine reports that state.
- The narrative does not convert automatic evidence to manual evidence or vice versa.
- Unknown per-rule detector confidence remains `null`; it is never invented.

## Failure and fallback behavior

The deterministic narrative is constructed synchronously after successful validation. AI coaching is attempted only after that narrative exists.

If the OpenAI key is absent, the request times out, the request fails, parsing fails, schema validation fails, or semantic-safety validation fails:

- the complete deterministic narrative is returned;
- `source` remains `DETERMINISTIC`;
- `fallbackUsed` is `true`;
- coaching-only fields remain absent;
- the validation verdict and existing response fields are unchanged.

An unexpected deterministic-builder exception currently prevents the request from being a successful validation response. It cannot produce a successful response that silently omits `decisionNarrative`.

## Rendering safety

Every narrative and coaching field must be rendered as plain text. React text interpolation is the expected rendering mechanism.

AI content must never be passed to `dangerouslySetInnerHTML`, interpreted as trusted HTML, or rendered through a markdown configuration that permits embedded HTML. Model output is untrusted text even after schema and semantic validation. Treating it as HTML would create an avoidable cross-site-scripting boundary and would incorrectly elevate coaching text to trusted application content.

## Release 2 consumption

Release 2 may consume `decisionNarrative` directly as a read model:

- the recommendation and headline provide the primary deterministic state;
- reasons and missing evidence explain that state;
- next actions provide deterministic operational guidance;
- readiness shows evidence completeness, never profit probability;
- coaching fields may appear in a visually secondary educational area;
- all text must be rendered as plain text;
- the UI must remain fully usable when coaching fields are absent.

Release 2 must not reproduce verdict mapping, evidence-mode logic, or action derivation in components.

## Technical debt before Release 3

Before Command Center persistence or longitudinal reuse, address:

1. **Stable reason codes** — replace index/message-derived reason identifiers with stable engine-owned codes.
2. **Schema and builder versioning** — distinguish public schema version, deterministic builder version, engine version, and any prompt version.
3. **Decision identifiers** — assign a durable identifier to each completed validation decision.
4. **Strategy provenance** — record the strategy identifier and immutable strategy/version snapshot used for the decision.
5. **Timestamp separation** — distinguish market-analysis time, validation time, narrative-generation time, and eventual persistence time.

The current narrative is suitable as an API read model. It should not be persisted as a durable decision event until those provenance and identifier concerns are resolved.

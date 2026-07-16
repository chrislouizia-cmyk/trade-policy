# Trade Police v21 — Strategy-aware AI voice

## Included
- Trade Police AI speaks automatically after live-market and screenshot analyses.
- The visible analyst panel follows the active strategy's AI Behavior settings.
- Direct, Educational, and Analytical tones produce materially different explanations.
- The response is grounded in deterministic evidence, confidence thresholds, mandatory rules, warnings, and candidate status.
- Confirmed evidence, missing evidence, policy alerts, and the next action are shown separately.
- Voice can be switched on/off and replayed. Preference is stored locally in the browser.
- The user's display name is used only when the active strategy allows it.

## Architecture
Market data / chart vision -> strategy evidence -> deterministic filters -> AI commentary -> final police authorization engine.

The AI explains the engine's findings. It does not issue the final authorization.

## Deployment
1. Run Supabase migrations through `017_v21_personal_trading_intelligence.sql` if not already applied.
2. Configure the same production environment variables used by v20 in Vercel.
3. Deploy the project root.
4. Test AI Behavior with at least two tones against the same market scan.

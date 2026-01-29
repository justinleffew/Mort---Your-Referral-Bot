# Realtor Radar Flow (Draft)

## Goals
- Support 50–200 contacts per Realtor.
- Ensure each contact is prompted for outreach at least **4x/year**.
- Use interest-based events sparingly to keep relevance high.

## High-Level Flow
1. **Contact intake**
   - Capture explicit interests and family details at creation or note entry.
2. **Interest normalization**
   - Normalize explicit interest cues into `radar_interests`.
3. **Cadence eligibility**
   - Every contact is eligible at least once per quarter (90 days).
4. **Event enrichment (monthly/quarterly)**
   - For contacts with interests, search external events using interest + location.
5. **Radar suggestions**
   - Generate a short set of message variants that reference the trigger.
6. **Suppression**
   - After a contact is marked “reached out,” suppress until the next cadence window.

## Suggested Scheduling
| Job | Frequency | Scope | Purpose |
| --- | --- | --- | --- |
| Cadence eligibility refresh | Daily | All contacts | Keep quarterly follow-ups on track |
| Interest event search | Monthly | Contacts with interests | Add timely reasons for outreach |
| Run-now preview | On demand | Top 10 contacts | Quick “who to text now” |

## Event Search Constraints
- Use API-based sources (no scraping).
- Only search for contacts with **explicit interests**.
- Limit to 1–2 top matches per contact per period.
- Cache results per contact to avoid repeated prompts for the same event.

## Message Guidance
- 2–5 variants, <320 characters, no emojis.
- Clearly reference the triggering event or reason.
- Avoid sales language and direct referral asks.

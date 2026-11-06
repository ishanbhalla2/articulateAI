Decide which feedback domain best fits this talk.

## Topic
{topic}

## Opening of the talk (transcript excerpt)
{excerpt}

## Domain library
{library}

## Instructions
- Choose the single domain from the library whose categories would give the most useful specialised feedback for this talk.
- Give a confidence from 0 to 1. Use 0.6 or more only if the domain clearly fits.
- If no domain fits well (confidence below 0.6), propose a new domain with exactly 5 specialised categories. Each category needs a short description and what scores of 1, 3 and 5 look like. Categories must be specific to the subject matter, not general speaking skills (clarity, delivery, audience fit, conciseness and presence are already covered).
- Keys use lower-case letters, numbers and underscores.
- Write in British English.

Return only JSON in this shape:
{
  "domain_key": "key from the library, or null",
  "confidence": 0.0,
  "reason": "one sentence",
  "proposal": null or {
    "domain_key": "new_key",
    "domain_name": "New Domain Name",
    "categories": [
      {"category_key": "...", "category_name": "...", "description": "...", "anchor_1": "...", "anchor_3": "...", "anchor_5": "..."}
    ]
  }
}

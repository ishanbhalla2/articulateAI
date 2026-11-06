{instructions}

## Topic
{topic}

## Domain
{domain}

## Selected audiences (all weighted equally)
{audiences}

Use the audiences as a lens across every category, not only Audience Fit. For mixed audiences, reward layering and signposting, and name any group that was underserved.

## Categories, with what scores of 1, 3 and 5 look like
{categories}

## Judges
The judges are the expert anchor. Where they agree, align with them and add evidence. Where they disagree, report it and say which view better fits the selected audiences. When a judge's critique reflects their own role rather than the audiences' needs, say so in `lens_note`.

{judges}

## Participant transcript (timestamps are minutes:seconds)
{participant}

{metrics}

## How thorough to be
{depth}

## Output
Return only one JSON object, no prose, in exactly this shape:
{schema}

Rules:
- Exactly these 10 categories, using these keys: {category_keys}.
- `score` is a whole number from 1 to 5, judged against the anchors above.
- Every `evidence.quote` must be copied word for word from the participant transcript (a short phrase of 5 to 25 words) with the timestamp of the line it comes from. Never quote the judges as evidence.
- `judges.by_judge` has one entry for each judge listed above, using their `judge_id`; set `comment` to null if that judge did not address the category.
- `audience_notes` and `audience_fit` cover each selected audience key: {audience_keys}.
- `audience_gaps` lists the keys of audiences that were underserved (empty list if none).
- Give 3 `top_strengths` and 3 `top_priorities`.
- Copy `delivery_metrics` exactly as given (use zeros if none were given); they are measured, not judged.

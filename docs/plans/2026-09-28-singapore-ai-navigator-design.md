# Singapore AI Navigator design

## Decision

Turn `superintelligencesg.com` into the useful public front door for the Singapore AI ecosystem. Preserve the voluntary Commons model by showing self-submitted profiles alongside a deliberately small public reference index.

## Why this model

A directory has value before an organization joins. A community has legitimacy when organizations choose to identify themselves. Combining both gives visitors a useful navigator while giving organizations a concrete reason to publish and maintain their own profiles.

## Information architecture

### `.com` — Navigator

- Homepage explains the three-domain system and makes the Navigator the primary action.
- `/directory.html` provides search, filters, source labels and organization routes.
- Public reference entries link to their official websites.
- Community entries are loaded from the Commons API and link back to the Commons directory.

### `.org` — Commons

- Keeps immediate self-publication with no approval gate.
- Adds an obvious route back to the Navigator.

### `.ai` — Lab

- Remains the place for research questions, lenses and future-facing exploration.

## Source and status language

- Public reference: selected from a public source; unclaimed; no endorsement implied.
- Community profile: submitted directly by the organization; published immediately.
- The collection is a starting point, not a ranking or claim of completeness.

## Interaction

- The directory opens with a useful search surface inside the first viewport.
- Search covers name, founder, description and tags.
- Filters separate public references from community profiles and group broad areas of work.
- Loading, empty and connection error states explain what happened and offer a next action.

## Visual direction

Use the established dark navy, warm white and gold system. Present results as an editorial index with ruled rows, not a wall of cards. Typography and spacing carry the hierarchy. Motion is limited to hover, focus and filter feedback.

## Acceptance criteria

- A visitor can understand the three domains without reading a long explanation.
- A visitor can search all available profiles from one page.
- Every result shows how it entered the navigator.
- An organization can reach the self-publishing form in one click.
- Desktop and mobile layouts remain readable with no horizontal overflow.


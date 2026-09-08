# Zoho community introductions — working plan

Prepared September 9, 2026; updated September 10. Research conducted September 8–9. The Admins
ZUG introduction was published September 9; the Developers ZUG draft remains awaiting user review.
Retain until the outreach is complete, then fold remaining current status into `docs/STATE.md`.

## Recommendation and evidence

The Admins ZUG resource introduction was published September 9. Prepare the distinct,
developer-oriented post for Developers ZUG next. Put its tracked product link in the first
paragraph: the Community Spaces feed collapses longer posts before the link when it is placed
near the end. There is no evidence that a fixed amount of prior activity guarantees a
digest/newsletter feature. The supplied correspondence encourages joining, sharing experiences,
and contributing; a requested editorial introduction is not a confirmed feature.

The user's LeadFilter reference is style inspiration, not instructions to run that campaign.
Carry over short paragraphs, a concrete problem first, plain language, clear builder disclosure,
and a useful question. Do not carry over its waitlist, product claims, old target threads, or
publication instructions. Keep these original posts around 80–110 words so the main capability
and screenshot remain easy to scan.

| Space | Observed audience and pattern | Suggested angle |
|---|---|---|
| [Developers Zoho User Group](https://www.zohocommunity.com/zcs/group/developers-zoho-user-group/feed) | 1,298 members when checked. Recent member discussions cover integration architecture, code, debugging, and development workflows. Detailed peer replies and community-manager participation. | Lead with keyword search across all Deluge functions; use services, API names, endpoints, and fields as examples. |
| [Admins Zoho User Group](https://www.zohocommunity.com/zcs/group/admins-zoho-user-group/feed) | 2,094 members when checked. Recent feed emphasizes webinars, setup, governance, practical configuration, and integration evaluation. | Lead with the same broad capability in plain language; connect it to understanding and maintaining CRM customizations. |

Representative discussions inspected (engagement is a changing snapshot, not comparative analytics):

- Developers: [AI development workflows](https://www.zohocommunity.com/zcs/stream/93270000011963331),
  September 7, 2026. At least 20 additional comments were visible behind the comments control;
  replies discuss actual testing, reviews, and implementation habits. Good evidence for an
  experience-based question. DevTools is not an AI product, so do not insert a product pitch there.
- Developers: [Zoho Catalyst 3.0](https://www.zohocommunity.com/zcs/stream/93270000011976836),
  September 7, 2026. Five additional comments plus visible replies about learning by building;
  Janaki also participates. Relevant tone example, not a DevTools promotion target.
- Developer feed also included a September 8 NinjaOne/Desk integration architecture question
  and a September 7 CRM/Books address-limit discussion with detailed workarounds.
- Admins: [Understanding Zoho MCP for Zoho Admins](https://www.zohocommunity.com/zcs/stream/93270000011438017),
  August 14 with September 3–4 replies. Members ask for clear setup instructions and access safeguards.
- Admins: [Vambe integration discussion](https://www.zohocommunity.com/zcs/stream/93270000011579609),
  August 24 with replies through August 31. Peer advice focuses on validating concrete workflows.
- Admins: [Zia Agents data-privacy question](https://www.zohocommunity.com/zcs/stream/93270000011654807),
  August 25 with August 26 replies. Shows interest in precise data-handling explanations;
  member claims about third-party AI behavior were not independently verified or reused.

The Developers About text invites ideas, questions, and peer learning; Admins invites practical
advice and solutions. No additional space-specific promotion policy was found in the feed/about
surfaces inspected. The developer announcement concerned Developers Day; the manuals dashboard
showed Functions 101, not an additional posting policy. This was a sample, not an exhaustive archive review.

[Zoho Community Guidelines](https://community.zoho.com/terms.html) explicitly cover both Forums
and Spaces. They prohibit duplicate/repetitive promotion, discourage reviving old threads solely
to advertise, and permit relevant third-party references that address the discussion. Keep useful
content in the post itself. Use product links in the relevant body, not a promotional signature.
The earlier moderation constraint in ADR 0003 remains unchanged. Do not represent the invitation as
Zoho endorsement or start posting every release to these spaces.

A global `DevTools` search returned one attachment in a 2025 Blueprint/client-script troubleshooting
conversation, unrelated to this extension. No existing extension introduction was found in that
search; this does not prove there is none under another name.

## Draft 1 — Developers space

Title: Search all Deluge functions in Zoho CRM

Hi everyone,

[Zoho CRM DevTools](https://chromewebstore.google.com/detail/zoho-crm-devtools/mjcppmfgjpllmmoneiaegecjlcpbfgmi?utm_source=zoho-community&utm_medium=community-space&utm_campaign=search-all-functions&utm_content=developers-zug)
is a free, open-source Chrome extension for Zoho CRM.

We've added Search All Functions: one place to search every Deluge function in your CRM org by
keyword.

Search for a service name such as `Mailchimp` or `Books`, a field API name such as `Lead_Source`,
part of an endpoint, or any other keyword. It searches function names, API names, descriptions,
and Deluge code across the entire org. You can preview a match and open it directly in Zoho's
native editor.

It's useful when debugging an integration, tracing a field, or finding older code without opening
functions one by one.

If you use it and find something missing, let us know.

[Attach the user-supplied Function Search screenshot here, separated from the text by a blank line.]

## Published — Admins space

Published September 9, 2026: [Search all functions in Zoho CRM](https://www.zohocommunity.com/zcs/stream/93270000012102033).
The final text is retained in
[the published post record](../posts/2026-09-09-admins-zug-search-all-functions.md).

## Screenshot and claim checks

- Use the supplied original screenshot; no image changes requested or made. It shows Mailchimp,
  14 results, 13 Standalone and 1 Automation. It demonstrates the search list, not the preview.
- The visible `oauth` and `zapikey` items are status labels/dots, not visible key values.
- Keep the search term and category counts legible. If a tighter crop is later requested, retain
  the dashboard and avoid shrinking the full desktop into a tiny thumbnail.
- The image includes real function/API names and installed-extension labels. The user supplied it
  for these posts; do not copy the image into the public git repository.
- [Current store listing](https://chromewebstore.google.com/detail/zoho-crm-devtools/mjcppmfgjpllmmoneiaegecjlcpbfgmi)
  confirms version 2.2.0, search fields, preview, and native-editor handoff.
- Local search implementation confirms matching against name/API name/description/source.
  Search finds text references; it is not a full dependency graph or proof that a change is safe.
- Do not repeat the older README/privacy document's "no network calls" claim: current function
  search makes authenticated requests to Zoho. The drafts avoid that stale claim. The old public
  privacy documentation deserves a separate correction task; it was not rewritten during outreach.

## Tracking parameters

Treat both posts as placements in one Search All Functions campaign:

- `utm_source=zoho-community` identifies the community.
- `utm_medium=community-space` distinguishes these Zoho Community Spaces from the older Forum outreach.
- `utm_campaign=search-all-functions` keeps both posts under the established feature campaign.
- `utm_content=developers-zug` and `utm_content=admins-zug` distinguish the two placements.

This preserves campaign-level reporting while allowing a direct comparison between the spaces.

## Publication and participation steps

1. User reviews the Developers ZUG draft and screenshot placement. No publication is authorized yet.
2. Publish the developer introduction under the user's requested account. Check rendered
   text, working links, image, author, and final post URL.
3. Answer actual questions and support reports in the same thread. Offer practical help on
   relevant community discussions without adding the extension link when it does not solve them.
4. Once there is a useful public discussion, supply its link and a short factual summary in any
   user-authorized follow-up to the digest/newsletter team. No email sent or drafted for sending here.
5. Update state and remove this temporary plan when the Developers introduction is published.

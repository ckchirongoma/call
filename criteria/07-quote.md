# 07 — Writing, checking and rendering the quotation (`write.ts`, `check.ts`, `quotedoc.ts`)

Owner: `test/write.test.ts`, `test/check.test.ts`, `test/quotedoc.test.ts`, `scripts/preview-quote.mjs` for the print smoke.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-0900 | check | numbers | Given writer text "R 850 a month" and 85000 cents allowed, then pass. | test/check.test.ts |
| C-0901 | check | numbers | Given writer text "R 900 a month" and only 850 allowed, then `numbers = fail` naming 900. | test/check.test.ts |
| C-0902 | check | numbers | Given "about twelve thousand" in the facts, then "12 000", "12000", "twelve thousand" all allowed. | test/check.test.ts |
| C-0903 | check | numbers | Given "23 years" (term from `term_months=276`), then 23 allowed. | test/check.test.ts |
| C-0904 | check | numbers | Given "75%" (IP rule), then percents listed in `premium_basis` are allowed; any other percent fails. | test/check.test.ts |
| C-0905 | check | numbers | Given a date in the text ("by 14 November"), then dates computed by code are allowed; others fail. | test/check.test.ts |
| C-0906 | check | numbers | Given "one" / "two" as words in prose ("one policy"), then small number words ≤ 12 are ignored. | test/check.test.ts |
| C-0907 | check | numbers | Given the FSP number in the text, then allowed. | test/check.test.ts |
| C-0908 | check | numbers | Given a number inside a product name ("Plan 100"), then allowed when it is in the product name. | test/check.test.ts |
| C-0909 | check | numbers | Given a fail, then the writer is re-run once with the report in the prompt. | test/write.test.ts |
| C-0910 | check | numbers | Given a second fail, then `quotes.status=held`, `checker_report.reason=numbers`. | test/journey.e2e.test.ts |
| C-0911 | check | numbers | Given held for numbers, then the broker page shows the offending sentence highlighted. | test/app.test.ts |
| C-0912 | check | numbers | Given the check passes, then `safety_events(check=quote_numbers, outcome=pass, engine=rules)`. | test/check.test.ts |
| C-0913 | check | menu | Given "Option 1 … Option 2", then `menu = fail`. | test/check.test.ts |
| C-0914 | check | menu | Given "alternatively you could", then fail. | test/check.test.ts |
| C-0915 | check | menu | Given "or you could choose", then fail. | test/check.test.ts |
| C-0916 | check | menu | Given "this would change if your income changes" (`alternative_if` form), then pass. | test/check.test.ts |
| C-0917 | check | menu | Given two product names in one recommendation's `why`, then fail. | test/check.test.ts |
| C-0918 | check | menu | Given the §6 considered list names several products, then pass (it is the considered section). | test/check.test.ts |
| C-0919 | check | you-told-me | Given "you told me you earn about twelve thousand" and the income fact is `confirmed`, then pass. | test/check.test.ts |
| C-0920 | check | you-told-me | Given the same with the fact `agent`, then fail `unconfirmed_claim`. | test/check.test.ts |
| C-0921 | check | you-told-me | Given "from our call, you earn about twelve thousand" with `agent`, then pass. | test/check.test.ts |
| C-0922 | check | you-told-me | Given "you mentioned" / "you said" with `transcript` confidence (meeting), then fail until broker-ticked. | test/check.test.ts |
| C-0923 | check | you-told-me | Given "you told me" about a fact that does not exist at all, then fail `invented_claim`. | test/check.test.ts |
| C-0924 | check | you-told-me | Given `broker` facts, then "your broker noted" is the required phrasing; "you told me" fails. | test/check.test.ts |
| C-0925 | check | claims | Given "guaranteed", then fail. | test/check.test.ts |
| C-0926 | check | claims | Given "approved", then fail. | test/check.test.ts |
| C-0927 | check | claims | Given "will pay out", then fail; "would pay" passes. | test/check.test.ts |
| C-0928 | check | claims | Given "best" / "the best", then fail. | test/check.test.ts |
| C-0929 | check | claims | Given "tax-free" inside a product category name, then pass. | test/check.test.ts |
| C-0930 | check | claims | Given "no medical questions" (an underwriting promise), then fail unless in the product `summary` verbatim. | test/check.test.ts |
| C-0931 | check | stale | Given a product with `stale=true` and the hedge sentence present, then pass. | test/check.test.ts |
| C-0932 | check | stale | Given stale and no hedge, then fail `stale_unhedged` and the renderer adds it (the check runs after render too). | test/check.test.ts |
| C-0933 | check | stale | Given the hedge wording, then it is exactly "This figure was last checked on {date}; your broker will confirm it." | test/quotedoc.test.ts |
| C-0934 | check | stale | Given all fresh, then no hedge anywhere. | test/quotedoc.test.ts |
| C-0935 | check | disclosures | Given the document lacks the indicative disclosure, then fail. | test/check.test.ts |
| C-0936 | check | disclosures | Given no FSP number, then fail. | test/check.test.ts |
| C-0937 | check | disclosures | Given no recording/data-use disclosure, then fail. | test/check.test.ts |
| C-0938 | check | disclosures | Given no "how to be forgotten" line, then fail. | test/check.test.ts |
| C-0939 | check | disclosures | Given demo products and no demo notice, then fail. | test/check.test.ts |
| C-0940 | check | disclosures | Given disclosures rows missing for the country, then the pipeline fails the step with incident `disclosures_missing` (never renders without them). | test/check.test.ts |
| C-0941 | check | engine | Given no Jev key and the `checker` model row enabled, then the rubric check runs on the model and `engine=model`. | test/check.test.ts |
| C-0942 | check | engine | Given Jev configured, then `engine=jev`. | test/check.test.ts |
| C-0943 | check | engine | Given neither, then rules-only, `safety_events(engine=none, outcome=unavailable)` and `/api/health.guardrails_live=false`. | test/check.test.ts |
| C-0944 | check | engine | Given the rubric score < 3, then regenerate once, then `held`. | test/check.test.ts |
| C-0945 | check | engine | Given the rubric times out, then rules result stands and `unavailable` logged. | test/check.test.ts |
| C-0946 | check | engine | Given the engine flags but rules pass, then `held` (flag is enough to hold; never to silently alter). | test/check.test.ts |
| C-0947 | doc | render | Given a built quote, then the HTML contains no `display:grid`, `display:flex`, `var(--`, `<link`, external `<style>` beyond `@page`/`@media print`. | test/quotedoc.test.ts |
| C-0948 | doc | render | Given the HTML, then every layout container is `<table role="presentation">`. | test/quotedoc.test.ts |
| C-0949 | doc | render | Given colours, then all are inline hex (`#171f1a`, `#1f7a4d`, etc.); no named colours or rgb(). | test/quotedoc.test.ts |
| C-0950 | doc | render | Given the HTML, then §1 header has broker name, FSP, date, "Prepared for {first name}", "Indicative". | test/quotedoc.test.ts |
| C-0951 | doc | render | Given §2, then facts grouped about you / money / have / owe / want, in that order. | test/quotedoc.test.ts |
| C-0952 | doc | render | Given an approximate fact, then the line says "about". | test/quotedoc.test.ts |
| C-0953 | doc | render | Given a superseded fact, then it does not appear. | test/quotedoc.test.ts |
| C-0954 | doc | render | Given a refused fact, then it does not appear. | test/quotedoc.test.ts |
| C-0955 | doc | render | Given §3, then needs in priority order with the client's words in quotes. | test/quotedoc.test.ts |
| C-0956 | doc | render | Given §4, then one block per recommendation with name, provider, cover, monthly premium, why (≤ 60 words), "this would change if". | test/quotedoc.test.ts |
| C-0957 | doc | render | Given §4, then no recommendation block names a second product. | test/quotedoc.test.ts |
| C-0958 | doc | render | Given a null-product recommendation, then it renders under "What we could not match yet". | test/quotedoc.test.ts |
| C-0959 | doc | render | Given §5, then the monthly total and the budget comparison line ("within the R600 you mentioned" / "R120 over"). | test/quotedoc.test.ts |
| C-0960 | doc | render | Given no budget, then §5 says "You didn't give a budget; your broker will check this fits." | test/quotedoc.test.ts |
| C-0961 | doc | render | Given §6, then every considered product with its reason in plain words ("more expensive", "needs you to be under 60"). | test/quotedoc.test.ts |
| C-0962 | doc | render | Given §6 reason codes, then `eligibility:is.employment` renders as "for people who are employed or self-employed". | test/quotedoc.test.ts |
| C-0963 | doc | render | Given §7 (replacement) only when applicable. | test/quotedoc.test.ts |
| C-0964 | doc | render | Given §8, then "Reply to this email / message, or {broker} will call you by {date}" with date = today + 3 working days (ZA public holidays from `holidays.ts`). | test/quotedoc.test.ts |
| C-0965 | doc | render | Given §8, then "Nothing is bought by replying." | test/quotedoc.test.ts |
| C-0966 | doc | render | Given §9, then every disclosure row for the country, in `disclosures.sort` order. | test/quotedoc.test.ts |
| C-0967 | doc | render | Given demo products, then the footer "Demo catalogue — illustrative products and premiums". | test/quotedoc.test.ts |
| C-0968 | doc | render | Given `@page`, then margins 18mm and `size: A4`. | test/quotedoc.test.ts |
| C-0969 | doc | render | Given page-break guards, then `page-break-before: always` before §4 and §6 and `page-break-inside: avoid` on each recommendation table. | test/quotedoc.test.ts |
| C-0970 | doc | render | Given `scripts/preview-quote.mjs --smoke`, then Chromium prints the fixture quote to PDF with ≥ 2 pages and exit 0. | scripts/preview-quote.mjs |
| C-0971 | doc | render | Given the PDF, then its text layer contains the FSP number and "Indicative" (pdf text extraction in the script). | scripts/preview-quote.mjs |
| C-0972 | doc | render | Given a 10-recommendation quote, then the HTML is under 200 KB. | test/quotedoc.test.ts |
| C-0973 | doc | render | Given all text, then HTML-escaped (a fact value `<script>` renders as text). | test/quotedoc.test.ts |
| C-0974 | doc | render | Given fonts, then only web-safe stacks inline (`Arial, Helvetica, sans-serif`); no @font-face. | test/quotedoc.test.ts |
| C-0975 | doc | render | Given images, then none (no logos in v1; the broker name is text). | test/quotedoc.test.ts |
| C-0976 | doc | render | Given the email body, then the same HTML with `<meta name="viewport">` and width 600 table. | test/email.test.ts |
| C-0977 | doc | render | Given dark-mode email clients, then `color-scheme: light` meta present. | test/quotedoc.test.ts |
| C-0978 | doc | render | Given the client's name contains an apostrophe, then rendered correctly. | test/quotedoc.test.ts |
| C-0979 | doc | render | Given the currency, then "R 1 234" spacing (ZA convention) everywhere. | test/quotedoc.test.ts |
| C-0980 | doc | render | Given the date, then "31 October 2026" format. | test/quotedoc.test.ts |
| C-0981 | doc | render | Given a meeting session, then §2 header says "What we noted in our meeting" instead of "What you told us". | test/quotedoc.test.ts |
| C-0982 | doc | render | Given a web session, then no "on the phone" wording. | test/quotedoc.test.ts |
| C-0983 | doc | render | Given the broker's `agent_name`, then it never appears in the document (the broker is the author). | test/quotedoc.test.ts |
| C-0984 | doc | render | Given the quote version, then footer "Version {n} · {date}". | test/quotedoc.test.ts |
| C-0985 | doc | render | Given an `over_budget` flag, then §5 says so plainly. | test/quotedoc.test.ts |
| C-0986 | doc | render | Given `negative_cashflow`, then the opening paragraph is the cautious variant. | test/quotedoc.test.ts |
| C-0987 | doc | render | Given the opening paragraph from the writer, then ≤ 40 words. | test/write.test.ts |
| C-0988 | doc | render | Given `why`, then ≤ 60 words; `alternative_if` ≤ 25 words; longer → trimmed at a sentence boundary and `safety_events(trimmed)`. | test/write.test.ts |
| C-0989 | doc | render | Given the writer uses a forbidden jargon word, then rewritten by the simple replacement table before the check. | test/write.test.ts |
| C-0990 | doc | render | Given the writer returns no `why`, then the fallback "This fits what you told us about {need}" with the need words. | test/write.test.ts |
| C-0991 | doc | demo | Given mixed demo and real products, then the demo notice names which lines are demo. | test/quotedoc.test.ts |
| C-0992 | doc | demo | Given only real products, then no demo notice. | test/quotedoc.test.ts |
| C-0993 | doc | demo | Given `is_demo`, then the product name is suffixed "(demo)" in §4. | test/quotedoc.test.ts |
| C-0994 | quote | edit | Given the broker edits cover, then a new `quotes` row `version=n+1`, old `status=superseded`. | test/app.test.ts |
| C-0995 | quote | edit | Given the new version, then write and check re-run. | test/app.test.ts |
| C-0996 | quote | edit | Given the edit, then `audit_log` has before/after. | test/app.test.ts |
| C-0997 | quote | edit | Given the broker edits the `why` text by hand, then the checker still runs on it. | test/app.test.ts |
| C-0998 | quote | edit | Given an edited `why` that fails the number check, then saved as `held` with the sentence highlighted. | test/app.test.ts |
| C-0999 | quote | edit | Given a superseded version, then it still renders at `/app/quotes/{id}` read-only. | test/app.test.ts |

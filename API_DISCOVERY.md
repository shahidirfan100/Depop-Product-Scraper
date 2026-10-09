# Depop API discovery

## Selected API

- Endpoint: `https://www.depop.com/presentation/api/v1/search/products/`
- Method: `GET`
- Authentication: No account authorization. A Cloudflare-cleared browser session is required; the request is issued from the same origin (`www.depop.com`) with the session cookies.
- Pagination: `page_info.last` is passed back as the `after` query parameter; `page_info.has_more` controls continuation.
- Request parameters: `what`, `limit`, `country`, `currency`, `from`, `include_like_count`, optional `sort`, URL filters, and `after`.
- Fields available: `id`, `brand_id`, `brand_name`, `active_status`, `status`, `category_name`, `description`, `pictures`, `location`, `country`, `discount_percentage`, `slug`, `variant_set_id`, `variants_all`, `listed_quantity`, `attributes`, `shipping_method`, `is_boosted`, `boosted_at`, `sizes`, `preview`, `like_count`, and the nested `pricing` object.
- Fields currently missing in the legacy actor: product ID, canonical product URL, brand, category, condition, colours, sizes, quantities, images, price breakdown, currency, discount, seller slug, location, country, likes, shipping, boost status, and structured attributes.
- Field count: 30+ unique fields in a listing response, compared with 8 legacy job fields from the unrelated Remote.co actor.
- API score: 100/100 using the updater rubric: JSON response 30, more than 15 fields 25, no account auth 20, cursor pagination 15, and a richer match than the legacy output 10.

## Evidence and candidate matrix

Verified 2026-10-01 from a live Patchright Chrome session and direct Impit probes.

| Candidate                                                                    | Profile                                                       | Result                                                                                           | Fields / pagination                                | Decision                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ----------------------- |
| `www.depop.com/presentation/api/v1/search/products/`                         | Same-origin `fetch` from a Cloudflare-cleared Patchright page | HTTP 200, `application/json`                                                                     | 30+ fields, `page_info.last`, `page_info.has_more` | Selected                |
| `webapi.depop.com/api/v2/search/products/`                                   | Desktop/Impit HTTP and browser-cookie requests                | HTTP 403 challenge cookieless; HTTP 410 when replayed with a session                             | Not usable                                         | Rejected                |
| `webapi.depop.com/api/v3/search/products/`                                   | Browser-cookie request from a cleared session                 | HTTP 410 Gone (`code`/`message`/`service`/`type` body)                                           | Not usable                                         | Rejected                |
| Depop search page (`/search/?q=`)                                            | Real Patchright page load + scroll                            | HTTP 200 HTML with 24 product links; **no client XHR/fetch for search results**                  | Server-rendered RSC only; first page only          | Discovery evidence only |
| Depop page RSC / React Query dehydrated state                                | Embedded `self.__next_f` payload                              | Contains the same `objects` + `page_info.last` shape the API returns                             | First-page data only; no direct cursor control     | Discovery evidence only |
| Impit `chrome`, `chrome136`, `chrome142`, `firefox`, `firefox144`, `okhttp5` | Cookieless JSON probes with and without `Referer`             | HTTP 403 Cloudflare challenge (`cf-mitigated: challenge`) for every browser profile and endpoint | Not usable cookieless                              | Rejected                |
| Impit `ios18`                                                                | Cookieless probe                                              | TLS handshake failure (`AlertReceived(DecodeError)`) against Depop                               | Not usable                                         | Rejected                |
| iOS Safari / Android app profiles                                            | Exact mobile/app headers                                      | Same Cloudflare challenge as desktop                                                             | Not usable                                         | Rejected                |

## Key finding: no client-side search request exists anymore

The `/search/` page no longer issues an XHR/fetch to the search API. Searching now streams results through Next.js server rendering:

- The response contains 24 product links in HTML.
- The same 24 listings, plus `page_info.last` and `meta.total_count`, are embedded in the RSC payload as a dehydrated React Query state (`queries[0].state.data.pages[0].data`).
- Zero `xhr`/`fetch` requests are made on load or after scrolling.

This is why the previous strategy — waiting for the site to fire its own search request and replaying it — never produced a response and failed the run.

## Verified request details

The working request is a same-origin browser fetch after the Cloudflare challenge is cleared:

```text
GET https://www.depop.com/presentation/api/v1/search/products/?what=jersey&limit=24&country=us&currency=USD&from=in_country_search&include_like_count=true
```

issued from a `www.depop.com` page via `fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })`.

- No `depop-device-id`, `depop-session-id`, or `depop-search-id` values are required.
- No manually supplied `User-Agent`, `Referer`, or browser-fingerprint headers are required; the browser supplies them.
- The session is established by navigating to `https://www.depop.com/` and waiting until the Cloudflare challenge clears. The challenge took 12-60 seconds in testing, so readiness is confirmed by polling the API until it returns a 2xx rather than by a fixed delay.
- Pagination was verified across 3 pages: page 1 returned 24 objects, pages 2-3 returned 22 each, with `page_info.last` advancing (`MnwyNHw...` → `M3w0OHw...` → `NHw3Mnw...`).

The successful response had this shape:

```json
{
    "meta": { "total_count": 4660887 },
    "page_info": {
        "has_more": true,
        "last": "MnwyNHwxNzkwODU4Nzc0.BOOSTED_EXHAUSTED.0"
    },
    "objects": [
        {
            "id": 934055861,
            "slug": "21gvin0age-vintage-2000s-new-york-giants-6b3d",
            "description": "Vintage 2000s New York Giants Retro Sportswear White Football Jersey",
            "pricing": { "currency_name": "USD", "current_price": {} },
            "pictures": [],
            "attributes": { "condition": "used_excellent", "product_type": "jerseys" }
        }
    ]
}
```

## Implementation decision

1. Patchright is the only data path. The Impit fast path was removed on 2026-10-09: through Unblocker it succeeded for the first few pages and then started timing out and getting blocked mid-run, so the browser session is now always used for fetching.
2. Recovery opens the public Depop homepage in Patchright (persistent Chrome context). It waits for the Cloudflare challenge to clear and then confirms readiness by probing the same-origin API until it returns 2xx.
3. Pages are fetched with `page.evaluate(fetch(...))` from that same origin using the session cookies, and paginated with `page_info.last` as the `after` parameter. The established session is reused for every page and only rebuilt if it starts failing.
4. The browser bootstrap reads only JSON API responses. It does not use DOM selectors, HTML parsing, JSON-LD, RSC extraction, or intercepted request headers.

If a browser session still receives a temporary block, bounded retries rotate to a new Apify Proxy session and a fresh profile when proxying is configured.

URL filters are translated into API parameters where the endpoint exposes the same filter. Search, localized search, category, and filtered search URLs are supported. A keyword is converted into the same `what` parameter when no URL is supplied. A URL takes precedence over the keyword.

## Resilience and proxy matrix (verified 2026-10-05)

Read this section first whenever a run fails.

### Impit browser profiles (historical - fast path removed)

The Impit fast path was removed on 2026-10-09 because it timed out and got blocked mid-run through Unblocker. This matrix is retained as discovery evidence. Every documented `Impit` profile was probed against the live endpoint. Profiles split into two clear groups:

| Profiles                                                                               | TLS handshake                           | Response                      | Decision                                          |
| -------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------- | ------------------------------------------------- |
| `chrome`, `chrome124`, `chrome125`, `chrome131`, `chrome136`, `chrome142`, `chrome151` | Completes                               | HTTP 403 Cloudflare challenge | Usable for the bounded fast path                  |
| `firefox`, `firefox128`, `firefox133`, `firefox135`, `firefox144`                      | Completes                               | HTTP 403 Cloudflare challenge | Usable for the bounded fast path                  |
| `okhttp`, `okhttp3`, `okhttp4`, `okhttp5`                                              | Completes                               | HTTP 403 Cloudflare challenge | Usable for the bounded fast path                  |
| `chrome100`, `chrome101`, `chrome104`, `chrome107`, `chrome110`, `chrome116`           | Rejected (`AlertReceived(DecodeError)`) | No response                   | Excluded - legacy TLS is refused by the edge      |
| `ios18`                                                                                | Rejected (`AlertReceived(DecodeError)`) | No response                   | Excluded - iOS TLS profile is refused by the edge |

The removed fast path cycled through `chrome`, `chrome142`, `firefox`, and `okhttp5`. `ignoreTlsErrors` does not rescue the excluded profiles: their failure is a server-side TLS alert, not a certificate-trust problem.

### Proxy behavior

- Patchright is the only data path. Direct HTTP requests (Impit) always receive the Cloudflare challenge, even when replayed with a real browser `cf_clearance` cookie, and through Unblocker they succeeded only briefly before timing out mid-run. The browser session is authoritative.
- Residential is the cost-effective Apify Proxy group for the Cloudflare-protected storefront. It usually clears the challenge, but a challenged residential IP can need a second session before it clears.
- Unblocker is the fastest and most reliable path and is the **default** as of 2026-10-09. Unblocker solves the Cloudflare challenge server-side. It has no sticky session, so no session ID is passed, and it intercepts TLS with a CA Chrome does not trust. The browser context therefore sets `ignoreHTTPSErrors: true` **only** on the explicit Unblocker path; direct and Residential runs keep strict certificate validation. Unblocker bills 10 units per successful request; switch to Residential for a lower-cost option.

### Verified proxy outcomes (2026-10-09)

| Proxy group   | Browser path                     | Result                                                    |
| ------------- | -------------------------------- | --------------------------------------------------------- |
| UNBLOCKER     | Works, `ignoreHTTPSErrors: true` | Succeeded, 48 items across 3 pages, first page in ~3 s    |
| RESIDENTIAL   | Clears after 1-2 sessions        | Succeeded, 20-96 items; one run needed a session rotation |
| None (direct) | Clears on a clean IP             | Succeeded locally, 20 items                               |

### Browser (Patchright) stealth configuration

The browser session uses Patchright's Pattern C persistent-context baseline, which is the configuration Patchright recommends and patches internally:

- `channel: 'chrome'` - real Chrome, not bundled Chromium.
- `headless: false` - headed, rendered under Xvfb on the Apify image.
- `noViewport: true` - avoids viewport-related automation flags.
- `launchPersistentContext` with a disposable, uniquely named profile per session.
- No custom `userAgent`, `args`, or fingerprint headers. Patchright adds `--disable-blink-features=AutomationControlled` and removes `--enable-automation`, `--disable-popup-blocking`, and other flag leaks itself.
- One proxy URL per context; a blocked or interrupted session is retired and rebuilt with a fresh profile and a fresh proxy session.
- Apify Unblocker intercepts TLS with an untrusted CA, so `ignoreHTTPSErrors: true` is set only on the explicit Unblocker path; Residential and direct runs keep strict certificate validation.

Verified 2026-10-05: four consecutive clean sessions each cleared the Cloudflare challenge and returned HTTP 200 from the same-origin API in 15-20 seconds. The earlier single 90-second stall was transient and is covered by the recovery contract below.

### Auto-healing contract

1. Patchright is the only fetch path, so there is no direct-HTTP fast path to fail. Every page is fetched from the established same-origin browser session.
2. Browser recovery creates up to 3 fresh persistent Chrome profiles. Attempt 1 reuses the pre-created Apify Proxy session; every later attempt rotates to a new proxy session and a new profile, so a blocked or interrupted IP is never reused.
3. Readiness is confirmed only by a 2xx JSON response from the same-origin API, polled every 3 s for up to 70 s. The title check is secondary and only decides when to reload a stalled interstitial.
4. If a challenge does not clear within 30 s, the page is reloaded once (bounded) before the ready timeout is reached.
5. If an established browser session later starts returning 403/429, a non-JSON body, or errors, it is discarded and rebuilt automatically.
6. Parsing is tolerant: item arrays are read from `objects`, `products`, `results`, `items`, nested `data.*`, or `meta.objects`, and the cursor from `page_info`/`meta`. A 2xx HTML body is treated as a not-ready challenge rather than a hard failure.
7. Session close never throws, so cleanup can never mask the original failure. Recovered pages keep using the documented cursor (`page_info.last` -> `after`) and output mapping; no input or output contract changes.

### Diagnosis order for a failed run

1. Re-read this file and confirm which profile and proxy path the run used.
2. Check the logged `Impit (...)` warning: a TLS `ConnectError` means the profile or proxy TLS trust is the cause; an HTTP 403 means Cloudflare challenged that request and the browser path should have taken over.
3. If the browser session itself fails, check for `ERR_TUNNEL_CONNECTION_FAILED` (proxy URL/protocol), a challenge page title that never clears (proxy IP reputation), or a navigation timeout (proxy session rotation).
4. Confirm the challenge title is recognized. Depop served the title **"Checking if the connection is secure."** with a Cloudflare Turnstile widget. The earlier challenge-title regex did not match it, so readiness kept polling the API to the timeout and the run failed with `last: HTTP 403`. The regex now covers this and the readiness probe no longer depends on the title to detect a cleared challenge.

### 2026-10-09 failure and fix

Observed run: Impit `chrome` timed out after 30 s, the direct JSON request returned HTTP 403, and both browser sessions failed with `Depop Cloudflare verification did not complete in time`. Root causes and fixes:

- The 30 s Impit timeout burned run budget on a proxy that could not connect. Fixed with a 12 s per-request timeout and a 15 s fast-path budget, stopping on the first transport error.
- The challenge title `Checking if the connection is secure.` was not in the detection regex. Fixed by broadening the regex and making the API probe the authoritative readiness signal on every poll.
- Only 2 browser sessions were attempted, each with a 90 s ready timeout, so the run could not recover. Fixed with 3 attempts, a 70 s ready timeout, a 30 s bounded reload, and a fresh proxy session plus profile on every retry.

## Rejected candidates

- `webapi.depop.com/api/v2/` returns HTTP 403 cookieless and HTTP 410 with a session.
- `webapi.depop.com/api/v3/` returns HTTP 410 Gone even with browser cookies, despite third-party references to that path.
- Every Impit browser emulation (`chrome*`, `firefox*`, `okhttp*`) is stopped by the Cloudflare challenge; `ios18` cannot complete the TLS handshake with Depop.
- The public Depop Seller API (`partnerapi.depop.com`) is authenticated and limited to a seller's own products, so it cannot provide marketplace search results.
- Page HTML/RSC data was not selected because it only contains the first page and offers no reliable cursor control for pagination.

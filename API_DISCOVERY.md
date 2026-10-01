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

1. A single bounded Impit probe still runs first. It is a fast path for any IP that is not challenged; on a challenged IP it returns HTTP 403 immediately (no retry) and the actor falls back without wasting time.
2. Recovery opens the public Depop homepage in Patchright (persistent Chrome context). It waits for the Cloudflare challenge to clear and then confirms readiness by probing the same-origin API until it returns 2xx.
3. Pages are fetched with `page.evaluate(fetch(...))` from that same origin using the session cookies, and paginated with `page_info.last` as the `after` parameter.
4. The browser bootstrap reads only JSON API responses. It does not use DOM selectors, HTML parsing, JSON-LD, RSC extraction, or intercepted request headers.

If a browser session still receives a temporary block, one bounded retry rotates to a new Apify Proxy session when proxying is configured.

URL filters are translated into API parameters where the endpoint exposes the same filter. Search, localized search, category, and filtered search URLs are supported. A keyword is converted into the same `what` parameter when no URL is supplied. A URL takes precedence over the keyword.

## Rejected candidates

- `webapi.depop.com/api/v2/` returns HTTP 403 cookieless and HTTP 410 with a session.
- `webapi.depop.com/api/v3/` returns HTTP 410 Gone even with browser cookies, despite third-party references to that path.
- Every Impit browser emulation (`chrome*`, `firefox*`, `okhttp*`) is stopped by the Cloudflare challenge; `ios18` cannot complete the TLS handshake with Depop.
- The public Depop Seller API (`partnerapi.depop.com`) is authenticated and limited to a seller's own products, so it cannot provide marketplace search results.
- Page HTML/RSC data was not selected because it only contains the first page and offers no reliable cursor control for pagination.

# Depop API discovery

## Selected API

- Endpoint: `https://www.depop.com/presentation/api/v1/search/products/`
- Method: `GET`
- Authentication: No account authorization was required in the verified public browser request. Cloudflare session state may still be required for some IPs.
- Pagination: `page_info.last` is passed back as the `after` query parameter; `page_info.has_more` controls continuation.
- Request parameters: `what`, `limit`, `country`, `currency`, `from`, `include_like_count`, optional `sort`, URL filters, and `after`.
- Fields available: `id`, `brand_id`, `brand_name`, `active_status`, `status`, `category_name`, `description`, `pictures`, `location`, `country`, `discount_percentage`, `slug`, `variant_set_id`, `variants_all`, `listed_quantity`, `attributes`, `shipping_method`, `is_boosted`, `boosted_at`, `sizes`, `preview`, `like_count`, and the nested `pricing` object.
- Fields currently missing in the legacy actor: product ID, canonical product URL, brand, category, condition, colours, sizes, quantities, images, price breakdown, currency, discount, seller slug, location, country, likes, shipping, boost status, and structured attributes.
- Field count: 30+ unique fields in a listing response, compared with 8 legacy job fields from the unrelated Remote.co actor.
- API score: 100/100 using the updater rubric: JSON response 30, more than 15 fields 25, no account auth 20, cursor pagination 15, and a richer match than the legacy output 10.

## Evidence and candidate matrix

| Candidate                                            | Profile                                                            | Result                                                                       | Fields / pagination                                | Decision                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `www.depop.com/presentation/api/v1/search/products/` | Browser fetch after Depop session                                  | HTTP 200, `application/json`                                                 | 30+ fields, `page_info.last`, `page_info.has_more` | Selected                                                  |
| `webapi.depop.com/api/v2/search/products/`           | Desktop, iOS Safari, Android-style HTTP probes                     | HTTP 403 without a browser session                                           | Not usable in cookieless probes                    | Fallback only                                             |
| `www.depop.com/presentation/api/v1/search/products/` | Desktop HTTP with browser-like `Referer` and generated request IDs | HTTP 403 without a browser session                                           | Not usable in cookieless probes                    | Requires proxy/session state                              |
| Depop page bootstrap / RSC payload                   | Desktop page response                                              | Structured data exists, but this is page content rather than a JSON endpoint | First-page data only; URL pagination is ignored    | Discovery evidence only, not used for extraction          |
| iOS Safari page/API profile                          | Exact iPhone Safari headers, HTTP/2 disabled                       | Page/API probes did not produce usable JSON without session state            | No reliable pagination result                      | Rejected                                                  |
| Android app/API profile                              | `okhttp` user agent and JSON accept header                         | HTTP 403 on API probe                                                        | No reliable pagination result                      | Rejected                                                  |
| Playwright/Patchright browser network request        | Live Chromium session, API request captured after page scroll      | HTTP 200 JSON; response contained `objects` and cursor                       | Full listing shape and cursor pagination           | Used only to verify the endpoint, not as actor extraction |

## Verified request details

The successful live request was:

```text
GET https://www.depop.com/presentation/api/v1/search/products/?what=jersey&after=<cursor>&limit=24&country=us&currency=USD&from=in_country_search&include_like_count=true
```

The request used the page `Referer` and short-lived `depop-device-id`, `depop-session-id`, and `depop-search-id` values. The actor generates those values per run and does not store or hardcode cookies, tokens, or authorization headers. Browser fingerprint headers remain under the HTTP client's coherent Chrome profile.

The successful response had this shape:

```json
{
    "meta": {},
    "page_info": {
        "has_more": true,
        "last": "<opaque cursor>"
    },
    "objects": [
        {
            "id": 877834945,
            "slug": "seller-listing-5417",
            "description": "Argentina Lionel Messi #10 Jersey",
            "pricing": { "currency_name": "USD", "current_price": {} },
            "pictures": [],
            "attributes": { "condition": "brand_new", "product_type": "jerseys" }
        }
    ]
}
```

## Implementation decision

The actor first makes a fast direct JSON probe with `impit`. A direct 403/410 is treated as a request-shape block, not retried with the same cookieless headers. Recovery opens the public search page in Patchright, waits for the site's session to settle, and captures the browser's own successful search API request. This captures the current short-lived Depop request IDs while the browser context supplies its cookies and normal browser headers. The requested API URL is then replayed from that same page context with `credentials: include`, the captured API-specific request IDs, and no manually supplied User-Agent or browser fingerprint headers.

The browser bootstrap brings the search results into view to trigger the site's own JSON request. It reads only the intercepted JSON response and request headers; it does not use DOM selectors, HTML parsing, JSON-LD parsing, or RSC extraction. If a browser session still receives a temporary block, one bounded retry uses a newly rotated Apify Proxy session when proxying is configured.

The previously tested `webapi.depop.com/api/v2/search/products/` host is not used as a normal fallback. It returned HTTP 403 in discovery and HTTP 410 in the affected cloud run, so trying it after a blocked request only adds delay and does not match the verified browser flow.

URL filters are translated into API parameters where the endpoint exposes the same filter. Search, localized search, category, and filtered search URLs are supported. A keyword is converted into the same `what` parameter when no URL is supplied. A URL takes precedence over the keyword.

## Rejected candidates

- The public Depop Seller API is authenticated and intended for a seller's own products, so it cannot provide public marketplace search results.
- Page HTML/RSC data was not selected because it is a page representation, has incomplete first-page streaming behavior, and does not provide reliable URL pagination.
- The `webapi.depop.com` endpoint was retained only as a fallback because direct cookieless probes returned HTTP 403, while the captured `www.depop.com/presentation` endpoint returned HTTP 200 JSON in a real session.

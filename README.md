## What does Depop Product Scraper do?

Depop Product Scraper collects structured public product listings from Depop search pages. Provide a Depop URL or a keyword such as `jersey`, choose a sort order, and receive clean listing records with titles, prices, brands, conditions, sizes, images, seller names, shipping details, and canonical product links.

It is useful for fashion market research, resale sourcing, competitor monitoring, price comparisons, catalog analysis, and product trend tracking. Search URLs can include supported Depop filters, and the scraper follows additional result pages using Depop's continuation data.

## Why use Depop Product Scraper?

- **Search by URL or keyword** - Use an existing Depop search URL or start with a simple search phrase.
- **Rich product records** - Capture product details, pricing, images, attributes, stock quantities, likes, shipping, and seller information in one dataset.
- **Flexible sorting** - Collect the most relevant, newest, most popular, lowest-priced, or highest-priced listings.
- **Clean output** - Empty and null fields are omitted from every record, making exports easier to analyze.
- **Controlled runs** - Set the result limit and maximum page count for quick checks or larger collections.
- **Automation ready** - Export the dataset to JSON, CSV, Excel, XML, or connect it to downstream workflows through Apify.

## What data can you extract from Depop?

| Field                                     | Description                             |
| ----------------------------------------- | --------------------------------------- |
| `product_id`                              | Depop product identifier                |
| `title`                                   | Listing title                           |
| `description`                             | Full listing description when published |
| `url`                                     | Canonical Depop product URL             |
| `brand`, `brand_id`                       | Brand name and identifier               |
| `category`, `product_type`                | Depop category and product type         |
| `price`, `original_price`, `currency`     | Current and original price details      |
| `discount_percentage`, `is_on_sale`       | Sale information when available         |
| `condition`, `colours`, `style`, `source` | Listing attributes                      |
| `sizes`, `listed_quantity`                | Available variants and quantity         |
| `primary_image`, `image_urls`             | Product image URLs                      |
| `location`, `country`                     | Seller listing location                 |
| `seller_username`                         | Seller username                         |
| `like_count`                              | Listing likes                           |
| `shipping`                                | Shipping method and parcel information  |
| `pricing`                                 | Detailed pricing breakdown              |

## How to use Depop Product Scraper

1. Open the Actor in Apify Console.
2. Add a Depop search URL or a keyword.
3. Choose sorting, result count, and page limit.
4. Add proxy settings when your region or request volume requires them.
5. Run the Actor and download or connect the dataset.

## Input Parameters

| Parameter            | Type    | Required | Default                     | Description                                                                                |
| -------------------- | ------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `url`                | String  | No*      | Depop jersey search example | Depop search, localized search, category, or filtered search URL.                          |
| `keyword`            | String  | No*      | `jersey`                    | Search phrase used when `url` is empty.                                                    |
| `sort`               | String  | No       | `relevance`                 | `relevance`, `newest`, `priceAscending`, `priceDescending`, or `popularity`.               |
| `results_wanted`     | Integer | No       | `20`                        | Maximum number of records to save.                                                         |
| `max_pages`          | Integer | No       | `10`                        | Maximum number of result pages to request.                                                 |
| `country`            | String  | No       | `us`                        | Storefront: `us`, `uk`, `au`, `eu`, `de`, `fr`, or `it`. A locale in `url` takes priority. |
| `proxyConfiguration` | Object  | No       | Not set                     | Optional Apify Proxy configuration.                                                        |

\* Provide either `url` or `keyword`. If both are provided, the URL is used and its filters are preserved.

## Usage Examples

### Search by keyword

Collect 20 relevant listings for a simple keyword search:

```json
{
    "keyword": "vintage football jersey",
    "sort": "relevance",
    "results_wanted": 20,
    "max_pages": 3
}
```

### Use a filtered Depop URL

Reuse a search URL with its query filters and collect the newest results:

```json
{
    "url": "https://www.depop.com/search/?q=jersey&sort=newest",
    "sort": "newest",
    "results_wanted": 48,
    "max_pages": 3,
    "country": "us"
}
```

### Collect a localized storefront

Collect UK-priced results from a localized search page:

```json
{
    "url": "https://www.depop.com/uk/search/?q=nike+hoodie",
    "sort": "priceAscending",
    "results_wanted": 50,
    "max_pages": 5,
    "country": "uk"
}
```

## Sample Output

```json
{
    "product_id": 877834945,
    "title": "Argentina Lionel Messi #10 Jersey",
    "description": "Argentina Lionel Messi #10 Jersey\n\nPremium quality Argentina jersey featuring Lionel Messi 10.",
    "url": "https://www.depop.com/products/mvshortswear-argentina-lionel-messi-10-jersey-5417/",
    "slug": "mvshortswear-argentina-lionel-messi-10-jersey-5417",
    "status": "STATUS_ONSALE",
    "active_status": "active",
    "category": "Jerseys",
    "brand": "Adidas",
    "brand_id": 151,
    "price": "22.99",
    "original_price": "35.00",
    "currency": "USD",
    "discount_percentage": 34,
    "is_on_sale": true,
    "primary_image": "https://media-photos.depop.com/r1/202416940/4505658533/P0.jpg",
    "image_urls": ["https://media-photos.depop.com/r1/202416940/4505658533/P0.jpg"],
    "location": "Grand Prairie, United States",
    "country": "US",
    "condition": "brand_new",
    "colours": ["white", "multi"],
    "gender": "male",
    "is_kids": false,
    "product_type": "jerseys",
    "seller_username": "mvshortswear",
    "sizes": [{ "name": "XL", "quantity": 7, "status": "STATUS_ONSALE" }],
    "listed_quantity": 7,
    "like_count": 0,
    "shipping": { "shipping_id": "USPS", "parcel_size": "medium", "payer": "buyer" },
    "pricing": { "currency_name": "USD", "is_reduced": true }
}
```

## Tips for best results

- Use a complete public Depop search URL when you need URL filters or a localized storefront.
- Start with `results_wanted: 20` while checking a new keyword or filter combination.
- Use `sort: newest` for new-listing monitoring and `priceAscending` for sourcing workflows.
- Set `max_pages` high enough to cover the requested result count. Each page can contain up to 24 listings.
- Use a suitable Apify Proxy configuration if Depop challenges requests from your region.
- Some fields are only published for certain listings. Missing fields are omitted from the record instead of being saved as null.

## Integrations and export formats

- **Google Sheets** - Export product rows for sourcing and price analysis.
- **Airtable** - Build a searchable resale catalog.
- **Webhooks** - Trigger downstream processing after a run finishes.
- **Make or Zapier** - Send new product data to no-code workflows.
- **Apify API** - Read datasets from applications, schedules, and monitoring jobs.

Datasets can be downloaded as JSON, CSV, Excel, XML, and other formats supported by Apify.

## Frequently Asked Questions

### Can I use a Depop URL instead of a keyword?

Yes. Add a public Depop search, localized search, category, or filtered URL in `url`. When both inputs are present, the URL takes priority.

### Does the scraper support pagination?

Yes. It follows Depop's continuation cursor until it reaches `results_wanted`, `max_pages`, or the end of the result set.

### Why is a field missing from one listing?

Depop does not publish every attribute for every listing. The dataset omits unavailable values, so missing fields reflect the source listing rather than a placeholder null.

### Can I export Depop data to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats.

### Can I schedule recurring Depop searches?

Yes. Create an Apify schedule to repeat a search hourly, daily, weekly, or at another interval supported by your workflow.

### Is collecting Depop data legal?

Public data collection may be permitted in some situations, but you are responsible for complying with Depop's terms, applicable laws, privacy obligations, and reasonable request limits.

## Related Actors

- [Shein Product Scraper](https://apify.com/shahidirfan/shein-product-scraper) - Collect fashion product data for market research and price comparisons.
- [Nike Product Scraper](https://apify.com/shahidirfan/nike-product-scraper) - Collect Nike product prices, sizes, colors, and availability.
- [Target Product Scraper](https://apify.com/shahidirfan/target-product-scraper) - Collect marketplace product data for catalog and price analysis.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is intended for legitimate collection of publicly available product information. Users are responsible for using the output responsibly and complying with applicable laws, platform terms, privacy requirements, and intellectual property rights.

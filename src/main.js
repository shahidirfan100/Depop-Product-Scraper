import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Actor, log } from 'apify';
import { chromium } from 'patchright';

const API_HOST = 'https://www.depop.com';
const API_PATH = '/presentation/api/v1/search/products/';
const PAGE_SIZE = 24;
const MAX_RETRIES = 3;
const MAX_BROWSER_SESSIONS = 3;
const BROWSER_READY_TIMEOUT_MS = 70000;
const BROWSER_READY_POLL_MS = 3000;
const BROWSER_FETCH_TIMEOUT_MS = 20000;
const CHALLENGE_RELOAD_AFTER_MS = 30000;
const SUPPORTED_SORTS = new Set(['relevance', 'newest', 'priceAscending', 'priceDescending', 'popularity']);

function cleanValue(value) {
    if (value === null || value === undefined || value === '') return undefined;

    if (Array.isArray(value)) {
        const cleaned = value.map(cleanValue).filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const cleaned = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            const cleanedNestedValue = cleanValue(nestedValue);
            if (cleanedNestedValue !== undefined) cleaned[key] = cleanedNestedValue;
        }
        return Object.keys(cleaned).length ? cleaned : undefined;
    }

    return value;
}

function parsePositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function localeFromPath(url) {
    const firstSegment = new URL(url).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return ['us', 'uk', 'au', 'eu', 'de', 'fr', 'it'].includes(firstSegment) ? firstSegment : undefined;
}

function currencyForCountry(country) {
    return (
        {
            us: 'USD',
            uk: 'GBP',
            au: 'AUD',
            eu: 'EUR',
            de: 'EUR',
            fr: 'EUR',
            it: 'EUR',
        }[country] || 'USD'
    );
}

function apiCountryForCountry(country) {
    return { uk: 'gb' }[country] || country;
}

function getSearchUrl(input) {
    const suppliedUrl = input.url;
    if (suppliedUrl) {
        let parsed;
        try {
            parsed = new URL(String(suppliedUrl));
        } catch {
            throw new Error('The URL input is not a valid absolute URL.');
        }

        if (!parsed.hostname.endsWith('depop.com')) {
            throw new Error('The URL must belong to depop.com.');
        }
        return parsed;
    }

    if (!input.keyword || !String(input.keyword).trim()) {
        throw new Error('Provide either a Depop search URL or a keyword.');
    }

    const searchUrl = new URL('https://www.depop.com/search/');
    searchUrl.searchParams.set('q', String(input.keyword).trim());
    return searchUrl;
}

function getQueryParams(searchUrl, input, country, currency, cursor) {
    const params = new URLSearchParams();
    const sourceParams = searchUrl.searchParams;

    const urlKeyword = sourceParams.get('q') || sourceParams.get('what');
    const keyword = urlKeyword || input.keyword;
    if (keyword) params.set('what', keyword);

    for (const key of [
        'brands',
        'sizes',
        'colours',
        'conditions',
        'priceMin',
        'priceMax',
        'gender',
        'isKids',
        'isDiscounted',
        'groups',
        'productTypes',
    ]) {
        const value = sourceParams.get(key);
        if (value !== null) params.set(key, value);
    }

    const sortFromUrl = sourceParams.get('sort');
    const sort = input.sort || sortFromUrl || 'relevance';
    if (!SUPPORTED_SORTS.has(sort)) {
        throw new Error(
            `Unsupported sort value: ${sort}. Use relevance, newest, priceAscending, priceDescending, or popularity.`,
        );
    }
    if (sort !== 'relevance') params.set('sort', sort);

    const pathMatch = searchUrl.pathname.match(/\/category\/(womens|mens|kids)\/([^/]+)(?:\/([^/]+))?/i);
    if (pathMatch) {
        const [, department, group, productType] = pathMatch;
        params.set('gender', department.toLowerCase() === 'mens' ? 'male' : 'female');
        params.set('isKids', String(department.toLowerCase() === 'kids'));
        params.set('groups', group);
        if (productType) params.set('productTypes', productType);
    }

    params.set('limit', String(PAGE_SIZE));
    params.set('country', country);
    params.set('currency', currency);
    params.set('from', 'in_country_search');
    params.set('include_like_count', 'true');
    if (cursor) params.set('after', cursor);
    return params;
}

function getImageUrls(item) {
    return (item.pictures || []).map((picture) => picture?.formats?.P0?.url).filter(Boolean);
}

function getTitle(description, slug) {
    const firstLine = String(description || '')
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
    return (
        firstLine ||
        String(slug || '')
            .replace(/-[a-z0-9]{4}$/i, '')
            .replace(/-/g, ' ')
            .trim() ||
        undefined
    );
}

function mapListing(item) {
    const attributes = item.attributes || {};
    const images = getImageUrls(item);
    const currentPrice = item.pricing?.current_price?.price_breakdown?.price?.amount;
    const originalPrice = item.pricing?.original_price?.price_breakdown?.price?.amount;
    const sellerUsername = item.slug?.split('-')[0];

    return cleanValue({
        product_id: item.id,
        title: getTitle(item.description, item.slug),
        description: item.description,
        url: item.slug ? `https://www.depop.com/products/${item.slug}/` : undefined,
        slug: item.slug,
        status: item.status,
        active_status: item.active_status,
        category: item.category_name,
        brand: item.brand_name,
        brand_id: item.brand_id,
        price: currentPrice,
        original_price: originalPrice !== currentPrice ? originalPrice : undefined,
        currency: item.pricing?.currency_name || item.pricing?.currency,
        discount_percentage: item.pricing?.discount_percentage ?? item.discount_percentage,
        is_on_sale: item.pricing?.is_reduced,
        primary_image: images[0],
        image_urls: images,
        location: item.location,
        country: item.country,
        condition: attributes.condition,
        colours: attributes.colour,
        gender: attributes.gender,
        is_kids: attributes.is_kids,
        style: attributes.style,
        source: attributes.source,
        product_type: attributes.product_type,
        additional_attributes: attributes.additional_attributes,
        seller_username: sellerUsername,
        sizes: item.sizes?.map((size) =>
            cleanValue({
                name: size.name,
                quantity: size.quantity,
                status: size.status,
            }),
        ),
        listed_quantity: item.listed_quantity,
        like_count: item.like_count,
        shipping: item.shipping_method,
        pricing: item.pricing,
        is_boosted: item.is_boosted,
        boosted_at: item.boosted_at,
    });
}

// Tolerant extraction: the documented shape is `objects`, but the endpoint has
// historically used sibling and nested keys. Pick the first array that is present
// instead of hard-failing on one shape.
function extractItems(data) {
    const candidates = [
        data?.objects,
        data?.products,
        data?.results,
        data?.items,
        data?.data,
        data?.data?.objects,
        data?.data?.products,
        data?.data?.results,
        data?.meta?.objects,
    ];
    return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function getNextPage(data) {
    const pageInfo = data?.page_info || data?.data?.page_info || data?.meta || data?.data?.meta || {};
    return {
        hasMore: Boolean(pageInfo.has_more ?? pageInfo.hasMore),
        cursor: pageInfo.last || pageInfo.next_cursor || pageInfo.cursor || pageInfo.after,
    };
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function newProxySessionId() {
    return randomUUID().replaceAll('-', '');
}

function getBrowserProxy(proxyUrl) {
    if (!proxyUrl) return undefined;

    const parsed = new URL(proxyUrl);
    const proxy = {
        server: `http://${parsed.host}`,
    };

    if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
    if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
    return proxy;
}

function getProxyGroups(proxyConfig) {
    return [
        ...(Array.isArray(proxyConfig?.groups) ? proxyConfig.groups : []),
        ...(Array.isArray(proxyConfig?.apifyProxyGroups) ? proxyConfig.apifyProxyGroups : []),
    ];
}

function usesUnblocker(proxyConfig) {
    return getProxyGroups(proxyConfig).some((group) => String(group).toUpperCase() === 'UNBLOCKER');
}

async function getProxyUrl(proxyConfiguration, useSession) {
    return proxyConfiguration?.newUrl(useSession ? newProxySessionId() : undefined);
}

async function closeBrowserSession(session) {
    if (!session) return;

    try {
        await session.context.close();
    } catch (error) {
        // A failed close must never mask the original failure that triggered recovery.
        log.warning(`Closing the browser session failed: ${String(error.message).split('\n')[0]}`);
    } finally {
        if (session.profilePath) {
            await rm(session.profilePath, { force: true, recursive: true }).catch(() => {});
        }
    }
}

// Cloudflare serves several interstitial titles. "Checking if the connection is
// secure." was observed live on Depop and was not matched by the earlier regex,
// so the actor kept probing the API until the ready timeout instead of reloading
// or rotating. Keep this list broad and title-empty treated as challenged.
function isChallengePage(title) {
    const trimmed = String(title || '').trim();
    if (!trimmed) return true;
    return /just a moment|attention required|checking your browser|checking if the connection is secure|verify you are human|verifying you are human|security check|one more step|please wait|enable javascript|ddos protection|^loading\b/i.test(
        trimmed,
    );
}

// Same-origin browser fetch. Running inside the page keeps the request on the
// Cloudflare-cleared origin and lets the real browser supply all headers,
// cookies, and TLS values, so nothing here is hardcoded. A bounded AbortController
// stops a hung request from stalling the run.
async function evaluateBrowserFetch(page, url) {
    return page.evaluate(
        async ({ targetUrl, timeoutMs }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(targetUrl, {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                    redirect: 'follow',
                    headers: { Accept: 'application/json' },
                    signal: controller.signal,
                });
                const body = await response.text();
                return {
                    status: response.status,
                    contentType: response.headers.get('content-type') || '',
                    body,
                };
            } catch (error) {
                return {
                    status: 0,
                    contentType: '',
                    body: '',
                    error: String((error && error.message) || error),
                };
            } finally {
                clearTimeout(timer);
            }
        },
        { targetUrl: url, timeoutMs: BROWSER_FETCH_TIMEOUT_MS },
    );
}

// Parse a same-origin response body. A challenge or redirect can return HTML with
// a 2xx status, so a body that starts with '<' is treated as not-ready rather
// than a hard failure.
function parseJsonBody(result) {
    const body = String(result?.body || '').trim();
    if (!body || body.startsWith('<')) return undefined;
    try {
        return JSON.parse(body);
    } catch {
        return undefined;
    }
}

// Depop gates the whole site behind a Cloudflare challenge and the JSON API
// rejects requests until that challenge clears. Readiness is therefore confirmed
// by probing the API on every poll: a 2xx JSON response is the only success
// signal. The title check only decides when a stalled challenge should be
// reloaded, so a title variant can never silently skip recovery.
async function waitForBrowserSession(page, probeUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = 'no response';
    let challengeSince = Date.now();
    let reloadedOnce = false;

    while (Date.now() < deadline) {
        if (page.isClosed()) throw new Error('The browser page closed before the Depop session was ready.');

        let probe;
        try {
            probe = await evaluateBrowserFetch(page, probeUrl);
        } catch (error) {
            lastStatus = String(error.message).split('\n')[0];
            await sleep(BROWSER_READY_POLL_MS);
            continue;
        }

        if (probe.status >= 200 && probe.status < 300 && parseJsonBody(probe)) return;
        if (probe.status >= 200 && probe.status < 300) {
            lastStatus = 'HTTP 200 (non-JSON challenge body)';
        } else if (probe.error) {
            lastStatus = probe.error;
        } else {
            lastStatus = `HTTP ${probe.status}`;
        }

        const title = await page.title().catch(() => '');
        if (isChallengePage(title)) {
            // A stalled challenge sometimes clears after a single reload. Do it
            // once, bounded, so a stuck interstitial cannot consume the whole budget.
            if (!reloadedOnce && Date.now() - challengeSince > CHALLENGE_RELOAD_AFTER_MS) {
                reloadedOnce = true;
                challengeSince = Date.now();
                log.warning('Cloudflare challenge is taking long; reloading the page once.');
                await page.reload({ waitUntil: 'commit', timeout: 60000 }).catch(() => {});
            }
        } else {
            challengeSince = Date.now();
        }

        await sleep(BROWSER_READY_POLL_MS);
    }

    throw new Error(`Depop Cloudflare verification did not complete in time (last: ${lastStatus}).`);
}

async function fetchJsonFromBrowser(page, url) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let result;
        try {
            result = await evaluateBrowserFetch(page, url);
        } catch (error) {
            if (attempt === MAX_RETRIES) throw error;
            log.warning(
                `Browser API retry ${attempt}/${MAX_RETRIES} after error: ${String(error.message).split('\n')[0]}`,
            );
            await sleep(attempt * 1500);
            continue;
        }

        if (result.status >= 200 && result.status < 300) {
            const data = parseJsonBody(result);
            if (data) return data;
            if (attempt === MAX_RETRIES) throw new Error('Depop browser API returned a non-JSON response.');
            log.warning(`Browser API retry ${attempt}/${MAX_RETRIES} after a non-JSON response.`);
            await sleep(attempt * 2000);
            continue;
        }

        if (attempt < MAX_RETRIES && [403, 429].includes(result.status)) {
            log.warning(`Browser API retry ${attempt}/${MAX_RETRIES} after HTTP ${result.status}.`);
            await sleep(attempt * 2000);
            continue;
        }

        throw new Error(`Depop browser API request returned HTTP ${result.status}.`);
    }

    throw new Error('Browser API retries exhausted.');
}

async function createBrowserApiSession(probeUrl, proxyUrl, ignoreHttpsErrors) {
    const profilePath = await mkdtemp(join(tmpdir(), 'depop-browser-'));
    let context;

    try {
        // Patchright stealth baseline: real Chrome channel, headed (Xvfb on the
        // Apify image), persistent context, and no custom viewport/user-agent/
        // fingerprint headers. Patchright patches the automation flags itself, so
        // no manual `--disable-blink-features` or header overrides are added.
        //
        // Apify Unblocker performs TLS interception with a CA Chrome does not
        // trust, so it surfaces as `ERR_CERT_AUTHORITY_INVALID`. That exception is
        // scoped to the explicit Unblocker path only; direct and Residential runs
        // keep strict certificate validation.
        context = await chromium.launchPersistentContext(profilePath, {
            channel: 'chrome',
            headless: false,
            noViewport: true,
            ...(ignoreHttpsErrors && { ignoreHTTPSErrors: true }),
            ...(proxyUrl && { proxy: getBrowserProxy(proxyUrl) }),
        });
        const page = await context.newPage();

        await page.goto('https://www.depop.com/', { waitUntil: 'commit', timeout: 60000 });
        await waitForBrowserSession(page, probeUrl, BROWSER_READY_TIMEOUT_MS);

        return { context, page, profilePath };
    } catch (error) {
        if (context) await closeBrowserSession({ context, profilePath });
        else await rm(profilePath, { force: true, recursive: true }).catch(() => {});
        throw error;
    }
}

// Establish a Depop browser API session and fetch the first page. Each attempt
// builds a fresh Patchright Chrome profile and, when a proxy is configured, a
// fresh Apify Proxy session, so a blocked or interrupted IP is never reused.
// The first attempt reuses the pre-created proxy URL; later attempts rotate.
async function openBrowserData(primaryUrl, proxyConfiguration, initialProxyUrl, useProxySession, ignoreHttpsErrors) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_BROWSER_SESSIONS; attempt++) {
        let browserProxyUrl = initialProxyUrl;
        if (proxyConfiguration && attempt > 1) {
            browserProxyUrl = await getProxyUrl(proxyConfiguration, useProxySession);
        }

        let session;
        try {
            session = await createBrowserApiSession(primaryUrl, browserProxyUrl, ignoreHttpsErrors);
            const data = await fetchJsonFromBrowser(session.page, primaryUrl);
            return { data, browserSession: session };
        } catch (error) {
            lastError = error;
            if (session) await closeBrowserSession(session);
            log.warning(
                `Browser session ${attempt}/${MAX_BROWSER_SESSIONS} failed: ${String(error.message).split('\n')[0]}`,
            );
        }
    }

    throw lastError || new Error('Unable to establish a Depop browser API session.');
}

async function main() {
    await Actor.init();
    let browserSession;
    try {
        const input = (await Actor.getInput()) || {};
        const searchUrl = getSearchUrl(input);
        const urlCountry = localeFromPath(searchUrl.href);
        const country = String(urlCountry || input.country || 'us').toLowerCase();
        const apiCountry = apiCountryForCountry(country);
        const currency = currencyForCountry(country);
        const resultsWanted = parsePositiveInteger(input.results_wanted, 20);
        const maxPages = parsePositiveInteger(input.max_pages, 10);

        if (input.url) {
            log.info(`Starting URL search | results=${resultsWanted} | max_pages=${maxPages}`);
        } else {
            log.info(
                `Starting keyword search | keyword=${String(input.keyword).trim()} | results=${resultsWanted} | max_pages=${maxPages}`,
            );
        }

        const proxyConfig = input.proxyConfiguration;
        const configuredGroups = getProxyGroups(proxyConfig);
        const hasCustomProxyUrls = Array.isArray(proxyConfig?.proxyUrls) && proxyConfig.proxyUrls.length > 0;
        const requestedApifyProxy = Boolean(proxyConfig?.useApifyProxy) || configuredGroups.length > 0;
        const isApifyCloud = Actor.isAtHome();
        let proxyConfiguration;

        if (hasCustomProxyUrls || (requestedApifyProxy && isApifyCloud)) {
            proxyConfiguration = await Actor.createProxyConfiguration({ ...proxyConfig });
        } else if (requestedApifyProxy) {
            log.info('Local run detected: ignoring Apify Proxy settings without external proxy credentials.');
        } else if (isApifyCloud) {
            proxyConfiguration = await Actor.createProxyConfiguration({
                useApifyProxy: true,
                apifyProxyGroups: ['RESIDENTIAL'],
            });
        }

        // Unblocker has no sticky session and performs TLS interception, so it
        // must not receive a session ID and its browser context must ignore the
        // intercepted certificate. Residential keeps sessions and strict TLS.
        const unblocker = usesUnblocker(proxyConfig);
        const useProxySession = !unblocker;
        const proxyUrl = proxyConfiguration ? await getProxyUrl(proxyConfiguration, useProxySession) : undefined;

        const seen = new Set();
        let cursor;
        let saved = 0;
        let pagesProcessed = 0;
        let stopReason = 'results_limit';

        while (saved < resultsWanted && pagesProcessed < maxPages) {
            const params = getQueryParams(searchUrl, input, apiCountry, currency, cursor);
            const primaryUrl = `${API_HOST}${API_PATH}?${params.toString()}`;
            let data;

            // Patchright is the only data path. Reuse the established session; if
            // it starts returning 403/429 or errors mid-pagination, discard it and
            // rebuild automatically with a fresh profile and proxy session.
            if (browserSession) {
                try {
                    data = await fetchJsonFromBrowser(browserSession.page, primaryUrl);
                } catch (error) {
                    log.warning(
                        `Existing browser session failed: ${String(error.message).split('\n')[0]}; starting a fresh session.`,
                    );
                    await closeBrowserSession(browserSession);
                    browserSession = undefined;
                }
            }

            if (!data) {
                ({ data, browserSession } = await openBrowserData(
                    primaryUrl,
                    proxyConfiguration,
                    proxyUrl,
                    useProxySession,
                    unblocker,
                ));
            }

            const rawItems = extractItems(data);
            if (!rawItems.length) {
                if (pagesProcessed === 0 && Object.keys(data || {}).length > 0) {
                    log.warning(`The response contained no listings. Response keys: ${Object.keys(data).join(', ')}`);
                }
                stopReason = 'no_more_results';
                break;
            }

            const batch = rawItems
                .map(mapListing)
                .filter((item) => item?.product_id && !seen.has(item.product_id))
                .slice(0, resultsWanted - saved);

            for (const item of batch) seen.add(item.product_id);
            if (batch.length) {
                await Actor.pushData(batch);
                saved += batch.length;
                log.info(`Saved ${batch.length} items. Total=${saved}/${resultsWanted}`);
            }

            pagesProcessed += 1;
            const next = getNextPage(data);
            if (!next.hasMore || !next.cursor || next.cursor === cursor) {
                stopReason = 'no_more_pages';
                break;
            }
            cursor = next.cursor;
        }

        if (pagesProcessed >= maxPages && saved < resultsWanted) stopReason = 'max_pages';
        log.info(`Done | saved=${saved} | pages=${pagesProcessed} | stop_reason=${stopReason}`);
    } finally {
        if (browserSession) {
            await closeBrowserSession(browserSession);
        }
    }
}

main()
    .then(() => Actor.exit())
    .catch((error) => {
        log.error(`Run failed: ${error.message}`);
        return Actor.fail(error.message);
    });

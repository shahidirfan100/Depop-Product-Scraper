import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { chromium } from 'patchright';

const API_HOST = 'https://www.depop.com';
const API_PATH = '/presentation/api/v1/search/products/';
const PAGE_SIZE = 24;
const MAX_RETRIES = 3;
const MAX_BROWSER_SESSIONS = 2;
const BROWSER_SESSION_WAIT_MS = 15000;
const BROWSER_API_WAIT_MS = 12000;
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

function extractItems(data) {
    if (Array.isArray(data?.objects)) return data.objects;
    if (Array.isArray(data?.products)) return data.products;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    return [];
}

function getNextPage(data) {
    return {
        hasMore: Boolean(data?.page_info?.has_more ?? data?.meta?.has_more),
        cursor: data?.page_info?.last || data?.meta?.cursor || data?.meta?.next_cursor,
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
        server: `${parsed.protocol}//${parsed.host}`,
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
    } finally {
        if (session.profilePath) await rm(session.profilePath, { force: true, recursive: true });
    }
}

async function fetchJson(client, url, headers) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await client.fetch(url, {
                headers,
                redirect: 'follow',
            });

            // A 403/410 is deterministic for this cookieless request shape. Retrying
            // the same request only adds latency; the browser session is the recovery.
            if ([403, 410].includes(response.status)) return response;

            if (response.status === 429 || response.status >= 500) {
                if (attempt === MAX_RETRIES) return response;
                log.warning(`Retry ${attempt}/${MAX_RETRIES} after HTTP ${response.status}.`);
                await sleep(attempt * 1500);
                continue;
            }

            return response;
        } catch (error) {
            if (attempt === MAX_RETRIES) throw error;
            log.warning(`Retry ${attempt}/${MAX_RETRIES} after request error: ${error.message}`);
            await sleep(attempt * 1000);
        }
    }

    throw new Error('Request retries exhausted.');
}

function isDepopSearchApiUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'www.depop.com' && parsed.pathname === API_PATH;
    } catch {
        return false;
    }
}

function browserReplayHeaders(capturedHeaders, referer) {
    const headers = {
        Accept: capturedHeaders.accept || 'application/json',
        Referer: capturedHeaders.referer || referer,
    };

    for (const headerName of ['accept-language', 'depop-device-id', 'depop-session-id', 'depop-search-id']) {
        if (capturedHeaders[headerName]) headers[headerName] = capturedHeaders[headerName];
    }

    return headers;
}

function waitForBrowserApiResponse(page, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            page.off('response', onResponse);
            resolve(undefined);
        }, timeoutMs);

        async function onResponse(response) {
            if (settled || !isDepopSearchApiUrl(response.url()) || response.status() !== 200) return;

            try {
                const data = await response.json();
                settled = true;
                clearTimeout(timeout);
                page.off('response', onResponse);
                resolve({
                    data,
                    headers: response.request().headers(),
                });
            } catch {
                // Another matching response may still contain a readable JSON body.
            }
        }

        page.on('response', onResponse);
    });
}

async function fetchJsonFromBrowser(page, url, headers) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const result = await page.evaluate(
            async ({ targetUrl, requestHeaders }) => {
                const response = await fetch(targetUrl, {
                    credentials: 'include',
                    headers: {
                        Accept: 'application/json',
                        ...requestHeaders,
                    },
                });
                return {
                    status: response.status,
                    body: await response.text(),
                };
            },
            { targetUrl: url, requestHeaders: headers },
        );

        if (result.status >= 200 && result.status < 300) {
            try {
                return JSON.parse(result.body);
            } catch (error) {
                throw new Error(`Depop browser API returned a non-JSON response: ${error.message}`);
            }
        }

        if (attempt < MAX_RETRIES && (result.status === 429 || result.status >= 500)) {
            log.warning(`Browser API retry ${attempt}/${MAX_RETRIES} after HTTP ${result.status}.`);
            await sleep(attempt * 1500);
            continue;
        }

        throw new Error(`Depop browser API request returned HTTP ${result.status}.`);
    }

    throw new Error('Browser API retries exhausted.');
}

async function createBrowserApiSession(searchUrl, proxyUrl) {
    const profilePath = await mkdtemp(join(tmpdir(), 'depop-browser-'));
    let context;

    try {
        context = await chromium.launchPersistentContext(profilePath, {
            channel: 'chrome',
            headless: false,
            noViewport: true,
            ...(proxyUrl && { proxy: getBrowserProxy(proxyUrl) }),
        });
        const page = await context.newPage();
        const firstApiResponse = waitForBrowserApiResponse(page, BROWSER_SESSION_WAIT_MS + BROWSER_API_WAIT_MS);

        await page.goto(searchUrl.href, { waitUntil: 'load', timeout: 90000 });
        await page.waitForTimeout(BROWSER_SESSION_WAIT_MS);

        // Depop commonly issues the search request when the result area is brought
        // into view. This only triggers the site's own API request; no DOM data is read.
        await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 2, 1200)));
        let captured = await firstApiResponse;

        if (!captured) {
            await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 2, 1200)));
            captured = await waitForBrowserApiResponse(page, BROWSER_API_WAIT_MS);
        }

        if (!captured) {
            throw new Error('The browser session did not produce a successful Depop search API response.');
        }

        return {
            context,
            page,
            profilePath,
            replayHeaders: browserReplayHeaders(captured.headers, searchUrl.href),
        };
    } catch (error) {
        try {
            if (context) await context.close();
        } finally {
            await rm(profilePath, { force: true, recursive: true });
        }
        throw error;
    }
}

async function fetchWithBrowserRecovery(
    searchUrl,
    primaryUrl,
    proxyConfiguration,
    proxyUrl,
    browserSession,
    useProxySession,
) {
    let session = browserSession;

    if (session) {
        try {
            const data = await fetchJsonFromBrowser(session.page, primaryUrl, session.replayHeaders);
            return { data, browserSession: session };
        } catch (error) {
            log.warning(`Existing browser session failed: ${error.message}; starting a fresh session.`);
            await closeBrowserSession(session);
            session = undefined;
        }
    }

    let lastBrowserError;
    for (let sessionAttempt = 1; sessionAttempt <= MAX_BROWSER_SESSIONS; sessionAttempt++) {
        let browserProxyUrl;
        if (proxyUrl || Actor.isAtHome()) {
            browserProxyUrl = sessionAttempt === 1 ? proxyUrl : await getProxyUrl(proxyConfiguration, useProxySession);
        }

        try {
            session = await createBrowserApiSession(searchUrl, browserProxyUrl);
            const data = await fetchJsonFromBrowser(session.page, primaryUrl, session.replayHeaders);
            return { data, browserSession: session };
        } catch (error) {
            lastBrowserError = error;
            if (session) {
                await closeBrowserSession(session);
                session = undefined;
            }
            log.warning(`Browser session ${sessionAttempt}/${MAX_BROWSER_SESSIONS} failed: ${error.message}`);
        }
    }

    throw lastBrowserError || new Error('Unable to establish a Depop browser API session.');
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
        }

        const useProxySession = !usesUnblocker(proxyConfig);
        const proxyUrl = proxyConfiguration ? await getProxyUrl(proxyConfiguration, useProxySession) : undefined;
        const client = new Impit({
            browser: 'chrome',
            ignoreTlsErrors: true,
            ...(proxyUrl && { proxyUrl }),
        });

        const requestHeaders = {
            accept: 'application/json',
            referer: searchUrl.href,
            'depop-device-id': randomUUID(),
            'depop-session-id': randomUUID(),
            'depop-search-id': randomUUID(),
        };
        const seen = new Set();
        let cursor;
        let saved = 0;
        let pagesProcessed = 0;
        let stopReason = 'results_limit';

        while (saved < resultsWanted && pagesProcessed < maxPages) {
            const params = getQueryParams(searchUrl, input, apiCountry, currency, cursor);
            const primaryUrl = `${API_HOST}${API_PATH}?${params.toString()}`;
            let data;
            if (browserSession) {
                ({ data, browserSession } = await fetchWithBrowserRecovery(
                    searchUrl,
                    primaryUrl,
                    proxyConfiguration,
                    proxyUrl,
                    browserSession,
                    useProxySession,
                ));
            } else {
                const response = await fetchJson(client, primaryUrl, requestHeaders);
                if (response.ok) {
                    try {
                        data = await response.json();
                    } catch (error) {
                        throw new Error(`Depop returned a non-JSON response: ${error.message}`);
                    }
                } else {
                    log.warning(
                        `Direct JSON request returned HTTP ${response.status}; bootstrapping a browser API session.`,
                    );
                    ({ data, browserSession } = await fetchWithBrowserRecovery(
                        searchUrl,
                        primaryUrl,
                        proxyConfiguration,
                        proxyUrl,
                        browserSession,
                        useProxySession,
                    ));
                }
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

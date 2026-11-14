(function (root) {
'use strict';

var PRODUCT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        name: { type: ['string', 'null'] },
        image: { type: ['string', 'null'] },
        price: { type: ['number', 'null'] },
        priceCurrency: { type: ['string', 'null'] },
        widthCm: { type: ['number', 'null'] },
        depthCm: { type: ['number', 'null'] },
        heightCm: { type: ['number', 'null'] },
        material: { type: ['string', 'null'] },
        color: { type: ['string', 'null'] }
    },
    required: ['name', 'image', 'price', 'priceCurrency', 'widthCm', 'depthCm', 'heightCm', 'material', 'color']
};

function first(value) {
    return Array.isArray(value) ? value[0] : value;
}

function text(value) {
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number') {
        var result = String(value).trim();
        return result || null;
    }
    if (typeof value === 'object') {
        return text(value.name || value.value || value.url || value['@id']);
    }
    return null;
}

function numeric(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    var match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    var result = Number(match[0]);
    return Number.isFinite(result) ? result : null;
}

function centimeters(value, unit) {
    if (value && typeof value === 'object') {
        unit = value.unitText || value.unitCode || value.unit || unit;
        value = value.value || value.minValue || value.maxValue;
    }
    var amount = numeric(value);
    if (amount == null || amount <= 0) return null;
    var normalizedUnit = String(unit || '').toLowerCase().replace(/[\s._-]/g, '');
    if (normalizedUnit === 'm' || normalizedUnit === 'meter' || normalizedUnit === 'meters' || normalizedUnit === 'metre' || normalizedUnit === 'metres' || normalizedUnit === 'mtr') return amount * 100;
    if (normalizedUnit === 'mm' || normalizedUnit === 'mmt' || normalizedUnit === 'millimeter' || normalizedUnit === 'millimeters' || normalizedUnit === 'millimetre' || normalizedUnit === 'millimetres') return amount / 10;
    if (normalizedUnit === 'in' || normalizedUnit === 'inh' || normalizedUnit === 'inch' || normalizedUnit === 'inches') return amount * 2.54;
    if (normalizedUnit === 'ft' || normalizedUnit === 'fot' || normalizedUnit === 'foot' || normalizedUnit === 'feet') return amount * 30.48;
    return amount;
}

function dimension(value) {
    if (value && typeof value === 'object') return centimeters(value);
    if (typeof value === 'string') {
        var match = value.match(/(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m|inches|inch|in|feet|foot|ft)?/i);
        if (match) return centimeters(match[1].replace(',', '.'), match[2]);
    }
    return centimeters(value);
}

function findProducts(node, found) {
    if (!node) return;
    if (Array.isArray(node)) {
        node.forEach(function (item) { findProducts(item, found); });
        return;
    }
    if (typeof node !== 'object') return;
    var types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some(function (type) { return typeof type === 'string' && type.toLowerCase() === 'product'; })) found.push(node);
    if (node['@graph']) findProducts(node['@graph'], found);
    if (node['@type'] === 'ItemList' && node.itemListElement) findProducts(node.itemListElement, found);
}

function metaContent(documentNode, key, attribute) {
    var node = documentNode.querySelector('meta[' + attribute + '="' + key + '"]');
    return node ? text(node.getAttribute('content')) : null;
}

function parsePage(html) {
    var documentNode = new DOMParser().parseFromString(html, 'text/html');
    var products = [];
    Array.prototype.forEach.call(documentNode.querySelectorAll('script[type="application/ld+json"]'), function (script) {
        try {
            findProducts(JSON.parse(script.textContent), products);
        } catch (error) {
            // Ignore malformed JSON-LD blocks and keep looking for usable product data.
        }
    });

    var product = products[0] || {};
    var offers = first(product.offers) || {};
    var priceSpecification = first(offers.priceSpecification) || {};
    var image = first(product.image);
    var result = {
        name: text(product.name),
        image: text(image),
        price: numeric(offers.price != null ? offers.price : priceSpecification.price),
        priceCurrency: text(offers.priceCurrency || priceSpecification.priceCurrency),
        widthCm: dimension(product.width),
        depthCm: dimension(product.depth),
        heightCm: dimension(product.height),
        material: text(product.material),
        color: text(product.color)
    };

    result.name = result.name || metaContent(documentNode, 'og:title', 'property');
    result.image = result.image || metaContent(documentNode, 'og:image', 'property');
    result.price = result.price == null ? numeric(metaContent(documentNode, 'product:price:amount', 'property')) : result.price;
    result.priceCurrency = result.priceCurrency || metaContent(documentNode, 'product:price:currency', 'property');
    result.name = result.name || metaContent(documentNode, 'twitter:title', 'name');
    result.image = result.image || metaContent(documentNode, 'twitter:image', 'name');
    return result;
}

function normalizeModelResult(value) {
    if (typeof value === 'string') value = JSON.parse(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('The structured extractor must return a product object.');
    }
    return {
        name: text(value.name),
        image: text(value.image),
        price: numeric(value.price),
        priceCurrency: text(value.priceCurrency),
        widthCm: dimension(value.widthCm),
        depthCm: dimension(value.depthCm),
        heightCm: dimension(value.heightCm),
        material: text(value.material),
        color: text(value.color)
    };
}

function fillMissing(primary, fallback) {
    Object.keys(primary).forEach(function (key) {
        if (primary[key] == null) primary[key] = fallback[key];
    });
    return primary;
}

function extractFurnitureProduct(url, adapters) {
    adapters = adapters || {};
    var parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (error) {
        return Promise.reject(new TypeError('Provide a valid absolute product URL.'));
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return Promise.reject(new TypeError('Only HTTP and HTTPS product URLs are supported.'));
    }
    if (typeof adapters.fetchPage !== 'function') {
        return Promise.reject(new TypeError('Provide a fetchPage adapter for an authorized page-fetching service.'));
    }

    return Promise.resolve(adapters.fetchPage(parsedUrl.href)).then(function (page) {
        if (typeof page === 'string') page = { html: page, markdown: '' };
        if (!page || typeof page !== 'object') throw new TypeError('fetchPage must return HTML or an object containing html and markdown.');
        var html = typeof page.html === 'string' ? page.html : '';
        var markdown = typeof page.markdown === 'string' ? page.markdown : '';
        if (!html && !markdown) throw new Error('The page-fetching service returned neither HTML nor Markdown.');

        var extracted = html ? parsePage(html) : {
            name: null, image: null, price: null, priceCurrency: null,
            widthCm: null, depthCm: null, heightCm: null, material: null, color: null
        };
        var needsSpecs = extracted.widthCm == null || extracted.depthCm == null || extracted.heightCm == null || extracted.material == null;
        if (!needsSpecs || !markdown || typeof adapters.extractStructured !== 'function') return extracted;

        return Promise.resolve(adapters.extractStructured({
            url: parsedUrl.href,
            markdown: markdown,
            existing: Object.assign({}, extracted),
            schema: PRODUCT_SCHEMA
        })).then(function (modelResult) {
            return fillMissing(extracted, normalizeModelResult(modelResult));
        });
    });
}

var api = { extractFurnitureProduct: extractFurnitureProduct, productSchema: PRODUCT_SCHEMA };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.RoomfitProductExtractor = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));

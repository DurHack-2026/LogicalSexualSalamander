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

function parseMeasurementMeters(value) {
    var unit = '';
    if (value && typeof value === 'object') {
        unit = value.unitText || value.unitCode || value.unit || '';
        value = value.value || value.minValue || value.maxValue;
    }
    var match = /^([\d\s,./]+)\s*(mm|mmt|cm|cmt|m|mtr|inches?|inh|in|["″]|feet|foot|ft|fot)$/i.exec(String(value || '').trim() + (unit ? ' ' + unit : ''));
    if (!match) return null;

    var amountText = match[1].trim();
    var fraction = /^(\d+(?:[.,]\d+)?)\s+(\d+)\/(\d+)$/.exec(amountText);
    var simpleFraction = /^(\d+)\/(\d+)$/.exec(amountText);
    var amount = fraction
        ? Number(fraction[1].replace(',', '.')) + Number(fraction[2]) / Number(fraction[3])
        : simpleFraction
            ? Number(simpleFraction[1]) / Number(simpleFraction[2])
            : Number(amountText.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return null;

    var normalizedUnit = match[2].toLowerCase();
    var multiplier = normalizedUnit === 'mm' || normalizedUnit === 'mmt' ? 0.001
        : normalizedUnit === 'cm' || normalizedUnit === 'cmt' ? 0.01
        : normalizedUnit === 'm' || normalizedUnit === 'mtr' ? 1
        : normalizedUnit === 'ft' || normalizedUnit === 'fot' || normalizedUnit === 'feet' || normalizedUnit === 'foot' ? 0.3048
        : 0.0254;
    return amount * multiplier;
}

function dimension(value) {
    var meters = parseMeasurementMeters(value);
    if (meters != null) return meters * 100;
    if (value && typeof value === 'object') return centimeters(value);
    if (typeof value === 'string') {
        var match = value.match(/(-?\d+(?:[.,]\d+)?)\s*(millimeters?|millimetres?|mm|mmt|centimeters?|centimetres?|cm|cmt|meters?|metres?|mtr|m|inches?|inh|in|feet|foot|fot|ft)?/i);
        if (match) return centimeters(match[1].replace(',', '.'), match[2]);
    }
    return centimeters(value);
}

function emptyProduct() {
    return {
        name: null, image: null, price: null, priceCurrency: null,
        widthCm: null, depthCm: null, heightCm: null, material: null, color: null
    };
}

function extractDimensionsFromText(value) {
    var result = { widthCm: null, depthCm: null, heightCm: null };
    var input = String(value || '');
    var number = '(-?\\d+(?:[.,]\\d+)?)';
    var unit = '(?:millimeters?|millimetres?|mm|mmt|centimeters?|centimetres?|cm|cmt|meters?|metres?|mtr|m|inches?|inh|in|feet|foot|fot|ft)';
    var labeled = new RegExp('\\b(width|wide|breadth|depth|deep|height|high|w|d|h)\\b\\s*(?:\\(\\s*(' + unit + ')\\s*\\))?\\s*[:=\\-]?\\s*' + number + '\\s*(' + unit + ')?', 'gi');
    var match;

    while ((match = labeled.exec(input))) {
        var label = match[1].toLowerCase();
        var field = label === 'width' || label === 'wide' || label === 'breadth' || label === 'w'
            ? 'widthCm'
            : label === 'depth' || label === 'deep' || label === 'd' ? 'depthCm' : 'heightCm';
        var measured = centimeters(match[3].replace(',', '.'), match[4] || match[2]);
        if (result[field] == null && measured != null) result[field] = measured;
    }

    var triple = new RegExp(number + '\\s*(' + unit + ')?\\s*[x×]\\s*' + number + '\\s*(' + unit + ')?\\s*[x×]\\s*' + number + '\\s*(' + unit + ')?', 'gi');
    while ((match = triple.exec(input))) {
        var before = input.slice(Math.max(0, match.index - 100), match.index);
        var after = input.slice(triple.lastIndex, triple.lastIndex + 50);
        var order = (before + ' ' + after).match(/\b(width|w)\b\s*[x×/]\s*(depth|d)\b\s*[x×/]\s*(height|h)\b/i);
        if (!order) order = (before + ' ' + after).match(/\b(height|h)\b\s*[x×/]\s*(width|w)\b\s*[x×/]\s*(depth|d)\b/i);
        if (!order) order = (before + ' ' + after).match(/\b(width|w)\b\s*[x×/]\s*(height|h)\b\s*[x×/]\s*(depth|d)\b/i);
        if (!order) continue;

        var sharedUnit = match[6] || match[4] || match[2];
        var values = [
            centimeters(match[1].replace(',', '.'), match[2] || sharedUnit),
            centimeters(match[3].replace(',', '.'), match[4] || sharedUnit),
            centimeters(match[5].replace(',', '.'), match[6] || sharedUnit)
        ];
        var axes = order.slice(1).map(function (axis) {
            return axis.toLowerCase() === 'w' || axis.toLowerCase() === 'width' ? 'widthCm'
                : axis.toLowerCase() === 'd' || axis.toLowerCase() === 'depth' ? 'depthCm' : 'heightCm';
        });
        for (var i = 0; i < axes.length; i++) {
            if (result[axes[i]] == null && values[i] != null) result[axes[i]] = values[i];
        }
    }
    return result;
}

function findProducts(node, found) {
    if (!node) return;
    if (Array.isArray(node)) {
        node.forEach(function (item) { findProducts(item, found); });
        return;
    }
    if (typeof node !== 'object') return;
    var types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some(function (type) { return typeof type === 'string' && type.toLowerCase().split(/[\/#:]/).pop() === 'product'; })) found.push(node);
    if (node['@graph']) findProducts(node['@graph'], found);
    if (types.some(function (type) { return typeof type === 'string' && type.toLowerCase().split(/[\/#:]/).pop() === 'itemlist'; }) && node.itemListElement) findProducts(node.itemListElement, found);
}

function productsFromDocument(documentNode) {
    var products = [];
    Array.prototype.forEach.call(documentNode.querySelectorAll('script[type="application/ld+json"]'), function (script) {
        try {
            findProducts(JSON.parse(script.textContent), products);
        } catch (error) {
            // Ignore malformed JSON-LD blocks and keep looking for usable product data.
        }
    });
    return products;
}

function getIkeaProductDimensions(documentNode, products) {
    products = products || productsFromDocument(documentNode);
    for (var i = 0; i < products.length; i++) {
        var widthMeters = parseMeasurementMeters(products[i].width);
        var heightMeters = parseMeasurementMeters(products[i].height);
        if (widthMeters != null && heightMeters != null) {
            return { widthMeters: widthMeters, heightMeters: heightMeters };
        }
    }
    return null;
}

function metaContent(documentNode, key, attribute) {
    var node = documentNode.querySelector('meta[' + attribute + '="' + key + '"]');
    return node ? text(node.getAttribute('content')) : null;
}

function extractPageText(documentNode) {
    if (!documentNode.body) return '';
    var body = documentNode.body.cloneNode(true);
    Array.prototype.forEach.call(body.querySelectorAll('script, style, noscript, svg, iframe'), function (node) {
        node.parentNode.removeChild(node);
    });

    var specRows = [];
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (row) {
        var cells = Array.prototype.map.call(row.querySelectorAll('th, td'), function (cell) {
            return cell.textContent.replace(/\s+/g, ' ').trim();
        }).filter(Boolean);
        if (cells.length > 1) specRows.push(cells[0] + ': ' + cells.slice(1).join(' '));
    });
    Array.prototype.forEach.call(body.querySelectorAll('dt'), function (label) {
        var value = label.nextElementSibling;
        if (value && value.tagName.toLowerCase() === 'dd') {
            specRows.push(label.textContent.trim() + ': ' + value.textContent.replace(/\s+/g, ' ').trim());
        }
    });

    var bodyText = body.textContent.replace(/\s+/g, ' ').trim();
    return (specRows.join(' | ') + ' ' + bodyText).trim().slice(0, 40000);
}

function additionalPropertyText(product) {
    var properties = product.additionalProperty || product.additionalProperties || [];
    if (!Array.isArray(properties)) properties = [properties];
    return properties.map(function (property) {
        if (!property || property.name == null || property.value == null) return '';
        var value = property.value;
        var unit = property.unitText || property.unitCode || property.unit || '';
        if (value && typeof value === 'object') {
            unit = value.unitText || value.unitCode || value.unit || unit;
            value = value.value || value.minValue || value.maxValue;
        }
        return text(property.name) + ': ' + text(value) + (unit ? ' ' + text(unit) : '');
    }).filter(Boolean).join(' | ');
}

function isIkeaPage(url) {
    return (url.hostname === 'ikea.com' || url.hostname.endsWith('.ikea.com')) &&
        !/\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname);
}

function ikeaProductImage(documentNode, pageUrl) {
    var url = new URL(pageUrl);
    if (!isIkeaPage(url)) return null;

    var slug = url.pathname.split('/').filter(Boolean).pop() || '';
    slug = slug.replace(/-\d+$/, '').toLowerCase();
    var allCandidates = new Map();
    Array.prototype.forEach.call(documentNode.querySelectorAll('img[src*="/images/products/"]'), function (imageElement) {
        var sourceSet = (imageElement.getAttribute('srcset') || '').split(',').map(function (entry) {
            var parts = entry.trim().split(/\s+/);
            var width = /^(\d+(?:\.\d+)?)w$/.exec(parts[1] || '');
            var density = /^(\d+(?:\.\d+)?)x$/.exec(parts[1] || '');
            return { source: parts[0], resolution: width ? Number(width[1]) : density ? Number(density[1]) : 0 };
        }).filter(function (candidate) { return candidate.source; });
        var bestSource = sourceSet.reduce(function (best, candidate) {
            return candidate.resolution > best.resolution ? candidate : best;
        }, { source: imageElement.getAttribute('src'), resolution: 0 });
        if (!bestSource.source) return;

        var image;
        try {
            image = new URL(bestSource.source, url.href).href;
        } catch (error) {
            return;
        }
        var key = new URL(image).pathname;
        var candidate = { description: imageElement.alt || '', image: image, resolution: bestSource.resolution };
        var previous = allCandidates.get(key);
        if (!previous || candidate.resolution > previous.resolution) allCandidates.set(key, candidate);
    });

    var candidates = Array.from(allCandidates.values());
    var productCandidates = candidates.filter(function (candidate) {
        return new URL(candidate.image).pathname.toLowerCase().indexOf('/images/products/' + slug + '__') >= 0;
    });
    var images = productCandidates.length ? productCandidates : candidates;
    if (!images.length) return null;

    var transparentImage = images.find(function (candidate) { return /\.png(?:[?#]|$)/i.test(candidate.image); });
    function imageScore(candidate) {
        var description = candidate.description.toLowerCase();
        return [
            ['plain background', 5], ['white background', 5], ['isolated', 4],
            ['cutout', 4], ['elegant', 3], ['clear', 1], ['with', 1]
        ].reduce(function (total, cue) {
            return total + (description.indexOf(cue[0]) >= 0 ? cue[1] : 0);
        }, 0) - (/\b(room|bedroom|kitchen|office|table|surrounded|interior|lifestyle)\b|red wine stands/i.test(description) ? 10 : 0);
    }
    var cleanImage = images.reduce(function (best, candidate) {
        return imageScore(candidate) > imageScore(best) ? candidate : best;
    }, images[0]);
    return (transparentImage || cleanImage).image;
}

function parsePage(html, pageUrl) {
    var documentNode = new DOMParser().parseFromString(html, 'text/html');
    var products = productsFromDocument(documentNode);
    var product = products[0] || {};
    var offers = first(product.offers) || {};
    var priceSpecification = first(offers.priceSpecification) || {};
    var image = ikeaProductImage(documentNode, pageUrl) || first(product.image);
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

    var parsedUrl = new URL(pageUrl);
    if (isIkeaPage(parsedUrl)) {
        var ikeaDimensions = getIkeaProductDimensions(documentNode, products);
        if (ikeaDimensions) {
            result.widthCm = result.widthCm == null ? ikeaDimensions.widthMeters * 100 : result.widthCm;
            result.heightCm = result.heightCm == null ? ikeaDimensions.heightMeters * 100 : result.heightCm;
        }
    }
    var structuredDimensions = extractDimensionsFromText([
        product.description,
        product.size,
        additionalPropertyText(product)
    ].filter(Boolean).join(' | '));
    result = fillMissing(result, structuredDimensions);
    result.name = result.name || metaContent(documentNode, 'og:title', 'property');
    result.image = result.image || metaContent(documentNode, 'og:image', 'property');
    result.price = result.price == null ? numeric(metaContent(documentNode, 'product:price:amount', 'property')) : result.price;
    result.priceCurrency = result.priceCurrency || metaContent(documentNode, 'product:price:currency', 'property');
    result.name = result.name || metaContent(documentNode, 'twitter:title', 'name');
    result.image = result.image || metaContent(documentNode, 'twitter:image', 'name');
    return { product: result, text: extractPageText(documentNode) };
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

        var pageData = html ? parsePage(html, parsedUrl.href) : { product: emptyProduct(), text: '' };
        var extracted = pageData.product;
        fillMissing(extracted, extractDimensionsFromText(pageData.text + ' ' + markdown));
        var needsSpecs = extracted.widthCm == null || extracted.depthCm == null || extracted.heightCm == null || extracted.material == null;
        var llmContent = [markdown, pageData.text ? 'Additional text extracted from HTML specifications and accordions:\n' + pageData.text : '']
            .filter(Boolean).join('\n\n').slice(0, 80000);
        if (!needsSpecs || !llmContent || typeof adapters.extractStructured !== 'function') return extracted;

        return Promise.resolve(adapters.extractStructured({
            url: parsedUrl.href,
            markdown: llmContent,
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

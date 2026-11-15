'use strict';

const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.ROOMFIT_PORT || 3000);
const HOST = process.env.ROOMFIT_HOST || '127.0.0.1';
const TRELLIS_PORT = Number(process.env.TRELLIS_PORT || 8766);
if (!Number.isInteger(TRELLIS_PORT) || TRELLIS_PORT < 1 || TRELLIS_PORT > 65535) {
    throw new Error('TRELLIS_PORT must be a valid TCP port.');
}
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 45000;
const MAX_IKEA_REDIRECTS = 5;
const STATIC_FILES = {
    '/': ['Roomfit.html', 'text/html; charset=utf-8'],
    '/roomfit.html': ['Roomfit.html', 'text/html; charset=utf-8'],
    '/Roomfit.html': ['Roomfit.html', 'text/html; charset=utf-8'],
    '/floorplan.html': ['floorplan.html', 'text/html; charset=utf-8'],
    '/Floorplan.html': ['floorplan.html', 'text/html; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/roomfit.js': ['roomfit.js', 'text/javascript; charset=utf-8'],
    '/floorplan.js': ['floorplan.js', 'text/javascript; charset=utf-8'],
    '/room-config-storage.js': ['room-config-storage.js', 'text/javascript; charset=utf-8'],
    '/ai_studio_code.js': ['ai_studio_code.js', 'text/javascript; charset=utf-8'],
    '/product-extractor.js': ['product-extractor.js', 'text/javascript; charset=utf-8']
};

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
}

async function readJson(request) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            const error = new Error('Request body is too large.');
            error.status = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
        return value;
    } catch (error) {
        const invalid = new Error('Request body must be a JSON object.');
        invalid.status = 400;
        throw invalid;
    }
}

function checkedHttpUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch (error) {
        const invalid = new Error('Provide a valid absolute product URL.');
        invalid.status = 400;
        throw invalid;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
        const invalid = new Error('Only credential-free HTTP and HTTPS product URLs are supported.');
        invalid.status = 400;
        throw invalid;
    }
    return url.href;
}

function isIkeaHostname(hostname) {
    return hostname === 'ikea.com' || hostname.endsWith('.ikea.com');
}

function checkedIkeaUrl(value) {
    const url = new URL(checkedHttpUrl(value));
    if (!isIkeaHostname(url.hostname) || url.port) {
        const invalid = new Error('Only standard-port IKEA product URLs are supported.');
        invalid.status = 400;
        throw invalid;
    }
    return url;
}

async function readResourceBytes(response) {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_PAGE_BYTES) {
        throw new Error('IKEA returned a resource that is too large to process.');
    }
    if (!response.body) return Buffer.alloc(0);

    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_PAGE_BYTES) throw new Error('IKEA returned a resource that is too large to process.');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function fetchIkeaResource(value, accept, expectedType) {
    let currentUrl = checkedIkeaUrl(value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        for (let redirects = 0; redirects <= MAX_IKEA_REDIRECTS; redirects++) {
            let response;
            try {
                response = await fetch(currentUrl.href, {
                    method: 'GET',
                    headers: { 'Accept': accept },
                    redirect: 'manual',
                    signal: controller.signal
                });
            } catch (error) {
                throw new Error(error.name === 'AbortError' ? 'IKEA resource request timed out.' : 'IKEA resource request failed.');
            }

            if ([301, 302, 303, 307, 308].indexOf(response.status) >= 0) {
                const location = response.headers.get('location');
                if (response.body) await response.body.cancel();
                if (!location) throw new Error('IKEA returned a redirect without a location.');
                if (redirects === MAX_IKEA_REDIRECTS) throw new Error('IKEA redirected too many times.');
                currentUrl = checkedIkeaUrl(new URL(location, currentUrl.href).href);
                continue;
            }
            if (!response.ok) throw new Error('IKEA returned HTTP ' + response.status + '.');
            const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if (expectedType === 'html' && contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
                throw new Error('IKEA did not return an HTML product page.');
            }
            if (expectedType === 'image' && !/^image\/(png|jpeg|webp|avif|gif)$/.test(contentType)) {
                throw new Error('IKEA did not return a supported product image.');
            }
            const body = await readResourceBytes(response);
            if (!body.length) throw new Error('IKEA returned an empty resource.');
            return { body: body, contentType: contentType || (expectedType === 'html' ? 'text/html' : 'image/jpeg') };
        }
        throw new Error('Could not follow IKEA resource redirects.');
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchIkeaPage(value) {
    const page = await fetchIkeaResource(value, 'text/html,application/xhtml+xml', 'html');
    return { html: page.body.toString('utf8'), markdown: '' };
}

async function fetchIkeaImage(value) {
    return fetchIkeaResource(value, 'image/avif,image/webp,image/png,image/jpeg,image/*', 'image');
}

async function callProvider(endpoint, token, payload, label) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        let response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: Object.assign(
                    { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    token ? { 'Authorization': 'Bearer ' + token } : {}
                ),
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (error) {
            throw new Error(error.name === 'AbortError' ? label + ' timed out.' : label + ' request failed.');
        }
        if (!response.ok) throw new Error(label + ' returned HTTP ' + response.status + '.');
        const responseText = await response.text();
        try {
            return JSON.parse(responseText);
        } catch (error) {
            const preview = responseText.replace(/\s+/g, ' ').trim().slice(0, 120);
            throw new Error(label + ' returned a non-JSON response' + (preview ? ': ' + preview : '.'));
        }
    } finally {
        clearTimeout(timeout);
    }
}

async function proxyTrellisApi(response, pathname, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        let upstream;
        try {
            upstream = await fetch('http://127.0.0.1:' + TRELLIS_PORT + pathname, {
                method: payload === undefined ? 'GET' : 'POST',
                headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
                body: payload === undefined ? undefined : JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (error) {
            const unavailable = new Error(error.name === 'AbortError'
                ? 'TRELLIS did not respond before the request timed out.'
                : 'Could not connect to the local TRELLIS service. Start ai_server_trellis.py and check its GPU tunnel.');
            unavailable.status = error.name === 'AbortError' ? 504 : 503;
            throw unavailable;
        }
        response.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        response.end(await upstream.text());
    } finally {
        clearTimeout(timeout);
    }
}

async function handleTrellisApi(request, response, pathname) {
    let targetPath;
    let payload;
    if (request.method === 'GET' && pathname === '/api/trellis/status') {
        targetPath = '/api/status';
    } else if (request.method === 'GET' && pathname === '/api/trellis/models') {
        targetPath = '/api/models';
    } else if (request.method === 'GET') {
        const taskMatch = pathname.match(/^\/api\/trellis\/tasks\/([A-Za-z0-9-]{8,100})$/);
        if (taskMatch) targetPath = '/api/tasks/' + taskMatch[1];
    } else if (request.method === 'POST' && pathname === '/api/trellis/generate') {
        targetPath = '/api/generate';
        payload = await readJson(request);
        try {
            payload.imageUrl = checkedIkeaUrl(payload.imageUrl).href;
        } catch (error) {
            sendJson(response, error.status || 400, { error: error.message });
            return;
        }
    }
    if (!targetPath) {
        if (pathname === '/api/trellis/generate' || pathname === '/api/trellis/status' ||
            pathname === '/api/trellis/models' || /^\/api\/trellis\/tasks\//.test(pathname)) {
            response.writeHead(405, { 'Allow': pathname === '/api/trellis/generate' ? 'POST' : 'GET' });
            response.end('Method not allowed.');
            return;
        }
        sendJson(response, 404, { error: 'TRELLIS API route not found.' });
        return;
    }
    await proxyTrellisApi(response, targetPath, payload);
}

async function serveGeneratedModel(response, taskId) {
    const filePath = path.join(__dirname, 'generated_trellis_models', taskId + '.glb');
    let stats;
    try {
        stats = await fs.stat(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            sendJson(response, 404, { error: 'Generated 3D model not found.' });
            return;
        }
        throw error;
    }
    if (!stats.isFile()) {
        sendJson(response, 404, { error: 'Generated 3D model not found.' });
        return;
    }
    response.writeHead(200, {
        'Content-Type': 'model/gltf-binary',
        'Content-Length': stats.size,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff'
    });
    const stream = fsSync.createReadStream(filePath);
    stream.on('error', function (error) {
        console.error('Could not stream a generated 3D model.', error);
        response.destroy();
    });
    stream.pipe(response);
}

async function handleApi(request, response, requestUrl) {
    const pathname = requestUrl.pathname;
    const llmUrl = process.env.ROOMFIT_LLM_URL;
    const llmToken = process.env.ROOMFIT_LLM_TOKEN;

    if (pathname.indexOf('/api/trellis/') === 0) {
        await handleTrellisApi(request, response, pathname);
        return;
    }
    if (request.method === 'GET' && pathname === '/api/config') {
        sendJson(response, 200, { pageFetcherConfigured: true, ikeaOnly: true, llmConfigured: Boolean(llmUrl) });
        return;
    }
    if (request.method === 'GET' && pathname === '/api/fetch-image') {
        const image = await fetchIkeaImage(requestUrl.searchParams.get('url'));
        response.writeHead(200, {
            'Content-Type': image.contentType,
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(image.body);
        return;
    }
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
    }

    const body = await readJson(request);
    if (pathname === '/api/fetch-page') {
        sendJson(response, 200, await fetchIkeaPage(body.url));
        return;
    }
    if (pathname === '/api/extract-structured') {
        if (!llmUrl) {
            sendJson(response, 503, { error: 'Structured extraction is not configured on the server.' });
            return;
        }
        const result = await callProvider(llmUrl, llmToken, body, 'Structured extraction provider');
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            sendJson(response, 502, { error: 'Structured extraction provider must return a JSON product object.' });
            return;
        }
        sendJson(response, 200, result);
        return;
    }
    sendJson(response, 404, { error: 'API route not found.' });
}

const server = http.createServer(async (request, response) => {
    let pathname;
    try {
        const requestUrl = new URL(request.url, 'http://' + request.headers.host);
        pathname = requestUrl.pathname;
        if (pathname.indexOf('/api/') === 0) {
            await handleApi(request, response, requestUrl);
            return;
        }
        const modelMatch = pathname.match(/^\/generated_models\/([A-Za-z0-9-]{8,100})\.glb$/);
        if (modelMatch) {
            if (request.method !== 'GET') {
                response.writeHead(405, { 'Allow': 'GET' });
                response.end('Method not allowed.');
                return;
            }
            await serveGeneratedModel(response, modelMatch[1]);
            return;
        }
        const file = STATIC_FILES[pathname];
        if (!file || request.method !== 'GET') {
            response.writeHead(404);
            response.end('Not found.');
            return;
        }
        const content = await fs.readFile(path.join(__dirname, file[0]));
        response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
        response.end(content);
    } catch (error) {
        if (response.headersSent) {
            response.destroy();
            return;
        }
        if (error.status) {
            sendJson(response, error.status, { error: error.message });
            return;
        }
        console.error('Request failed.');
        sendJson(response, 502, { error: error.message || 'The extraction request failed.' });
    }
});

server.listen(PORT, HOST, () => {
    console.log('Roomfit listening on http://' + HOST + ':' + PORT);
});

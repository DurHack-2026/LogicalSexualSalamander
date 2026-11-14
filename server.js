'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.ROOMFIT_PORT || 3000);
const HOST = process.env.ROOMFIT_HOST || '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 45000;
const STATIC_FILES = {
    '/': ['Roomfit.html', 'text/html; charset=utf-8'],
    '/roomfit.html': ['Roomfit.html', 'text/html; charset=utf-8'],
    '/Roomfit.html': ['Roomfit.html', 'text/html; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/roomfit.js': ['roomfit.js', 'text/javascript; charset=utf-8'],
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
        try {
            return await response.json();
        } catch (error) {
            throw new Error(label + ' returned invalid JSON.');
        }
    } finally {
        clearTimeout(timeout);
    }
}

async function handleApi(request, response, pathname) {
    const pageUrl = process.env.ROOMFIT_PAGE_FETCH_URL;
    const pageToken = process.env.ROOMFIT_PAGE_FETCH_TOKEN;
    const llmUrl = process.env.ROOMFIT_LLM_URL;
    const llmToken = process.env.ROOMFIT_LLM_TOKEN;

    if (request.method === 'GET' && pathname === '/api/config') {
        sendJson(response, 200, { pageFetcherConfigured: Boolean(pageUrl), llmConfigured: Boolean(llmUrl) });
        return;
    }
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
    }

    const body = await readJson(request);
    if (pathname === '/api/fetch-page') {
        if (!pageUrl) {
            sendJson(response, 503, { error: 'Page fetching is not configured on the server.' });
            return;
        }
        const result = await callProvider(pageUrl, pageToken, { url: checkedHttpUrl(body.url) }, 'Page provider');
        if (!result || typeof result !== 'object' || (typeof result.html !== 'string' && typeof result.markdown !== 'string')) {
            sendJson(response, 502, { error: 'Page provider must return JSON containing html or markdown.' });
            return;
        }
        sendJson(response, 200, { html: result.html || '', markdown: result.markdown || '' });
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
        pathname = new URL(request.url, 'http://' + request.headers.host).pathname;
        if (pathname.indexOf('/api/') === 0) {
            await handleApi(request, response, pathname);
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

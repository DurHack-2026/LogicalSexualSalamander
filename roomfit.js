
(function () {
'use strict';
var $ = function (s) { return document.querySelector(s); };
var cssv = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
var DEG = Math.PI / 180;

/* ---------- state ---------- */
var room = { shape: 'rect', w: 420, l: 360, h: 250, wallColor: '#2B3A35', transparentWalls: true };
var items = [];
var selId = null;
var uid = 1;

/* ---------- helpers ---------- */
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
function gbp(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }
function lum(hex) {
var c = hex.replace('#', '');
var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
return 0.299 * r + 0.587 * g + 0.114 * b;
}

/* =====================================================
    MODULE 1. Room generation
    ===================================================== */
function roomPoly(r) {
var w = r.w, l = r.l;
if (r.shape === 'L') {
    var cw = Math.round(w * 0.4), cl = Math.round(l * 0.42);
    return [[0, 0], [w - cw, 0], [w - cw, cl], [w, cl], [w, l], [0, l]];
}
if (r.shape === 'bay') {
    var a = Math.round(l * 0.16), x0 = Math.round(w * 0.25), x1 = Math.round(w * 0.75);
    return [[0, a], [x0, a], [x0, 0], [x1, 0], [x1, a], [w, a], [w, l], [0, l]];
}
return [[0, 0], [w, 0], [w, l], [0, l]];
}

function roomOpenings(r) {
var w = r.w, l = r.l, d1 = 30, d2 = Math.min(120, w - 30);
var door = { x0: d1, x1: d2, y: l };
var win;
if (r.shape === 'L') {
    var top = Math.round(w - w * 0.4), c = top / 2, half = Math.min(70, top / 2 - 20);
    win = { x0: c - half, x1: c + half, y: 0 };
} else if (r.shape === 'bay') {
    win = { x0: w * 0.4, x1: w * 0.6, y: 0 };
} else {
    win = { x0: w * 0.25, x1: w * 0.75, y: 0 };
}
return { door: door, win: win };
}

function polyArea(p) {
var a = 0;
for (var i = 0; i < p.length; i++) { var q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
return Math.abs(a) / 2;
}
function pointInPoly(pt, poly) {
var x = pt[0], y = pt[1], inside = false;
for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
}
return inside;
}

/* =====================================================
    MODULE 2. Furniture data from links
    ===================================================== */
var STOP = { www: 1, p: 1, product: 1, products: 1, item: 1, gb: 1, en: 1, uk: 1, us: 1, html: 1, htm: 1, shop: 1, buy: 1, pd: 1, dp: 1, collections: 1, catalog: 1, detail: 1 };
var CATS = [
{ id: 'sofa', re: /sofa|couch|settee|loveseat/, label: 'Sofa', w: 210, d: 92, h: 84, price: [450, 1400], color: '#8A9A8B', mat: 'Fabric' },
{ id: 'armchair', re: /armchair|recliner|accent chair|lounge chair/, label: 'Armchair', w: 85, d: 88, h: 85, price: [220, 700], color: '#B07A5A', mat: 'Fabric' },
{ id: 'coffee', re: /coffee table|side table|bedside|nightstand|end table/, label: 'Coffee table', w: 100, d: 55, h: 42, price: [90, 320], color: '#B98F62', mat: 'Oak' },
{ id: 'bed', re: /\bbed\b|bedframe|mattress|divan/, label: 'Bed', w: 150, d: 205, h: 100, price: [350, 1100], color: '#9AA3B5', mat: 'Fabric' },
{ id: 'dining', re: /dining table|\btable\b/, label: 'Dining table', w: 160, d: 90, h: 75, price: [200, 800], color: '#A47C55', mat: 'Oak' },
{ id: 'desk', re: /desk/, label: 'Desk', w: 140, d: 70, h: 75, price: [120, 420], color: '#C8B08A', mat: 'Birch' },
{ id: 'chair', re: /chair|stool|bench/, label: 'Chair', w: 46, d: 52, h: 86, price: [45, 180], color: '#6F7F8E', mat: 'Wood' },
{ id: 'wardrobe', re: /wardrobe|armoire|closet/, label: 'Wardrobe', w: 100, d: 58, h: 200, price: [180, 700], color: '#E3E0D8', mat: 'Wood' },
{ id: 'bookcase', re: /bookcase|bookshelf|shelving|shelf/, label: 'Bookcase', w: 80, d: 30, h: 180, price: [70, 260], color: '#B08B62', mat: 'Pine' },
{ id: 'sideboard', re: /sideboard|tv unit|cabinet|dresser|drawers|console/, label: 'Sideboard', w: 150, d: 40, h: 58, price: [140, 520], color: '#7A5A44', mat: 'Walnut' },
{ id: 'lamp', re: /lamp|light/, label: 'Lamp', w: 38, d: 38, h: 160, price: [35, 180], color: '#2A2F33', mat: 'Metal' },
{ id: 'rug', re: /rug|carpet/, label: 'Rug', w: 200, d: 140, h: 1, price: [60, 350], color: '#B9B5AB', mat: 'Wool' },
{ id: 'plant', re: /plant|ficus|monstera/, label: 'Plant', w: 40, d: 40, h: 110, price: [20, 90], color: '#4F7D55', mat: 'Ceramic pot' }
];
var COLOURS = {
grey: '#8E9396', gray: '#8E9396', charcoal: '#3E4348', black: '#22252A', white: '#EDEBE6', cream: '#E8DFC8',
beige: '#D9C9AC', brown: '#7A5538', tan: '#B88F62', oak: '#C69C6D', walnut: '#5C3D2A', green: '#5E7F63',
sage: '#8A9A8B', navy: '#2F4468', blue: '#4D74A8', teal: '#2F7F82', red: '#A8412E', terracotta: '#B8603F',
mustard: '#D4A12E', yellow: '#D9B84A', pink: '#D49CA6', orange: '#D2763A', rust: '#A5532D'
};
var MATERIALS = {
oak: 'Oak', walnut: 'Walnut', pine: 'Pine', birch: 'Birch', wood: 'Wood', velvet: 'Velvet', linen: 'Linen', boucle: 'Bouclé',
leather: 'Leather', fabric: 'Fabric', steel: 'Steel', metal: 'Metal', glass: 'Glass', marble: 'Marble', rattan: 'Rattan',
cane: 'Cane', wool: 'Wool'
};
var MAT_COLOUR = { oak: 'oak', walnut: 'walnut' };
var SIZE_WORDS = [
{ re: /super ?king/, w: 180, d: 205 }, { re: /\bking\b/, w: 150, d: 205 }, { re: /\bdouble\b/, w: 135, d: 195 },
{ re: /\bsingle\b/, w: 90, d: 195 }
];

function createFurnitureFallback(raw) {
var s = raw.trim();
if (!s) return null;
if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
var u;
try { u = new URL(s); } catch (e) { return null; }
if (u.hostname.indexOf('.') < 0) return null;
var host = u.hostname.replace(/^www\./, '').split('.');
var retailer = cap(host[0]);
var path = decodeURIComponent(u.pathname).toLowerCase();
var tokens = path.split(/[^a-z0-9£]+/).filter(Boolean);
var joined = tokens.join(' ');

var cat = null;
for (var i = 0; i < CATS.length; i++) { if (CATS[i].re.test(joined)) { cat = CATS[i]; break; } }
var base = cat || { id: 'generic', label: 'Furniture', w: 80, d: 60, h: 80, price: [60, 300], color: '#9A9A94', mat: 'Wood' };
var prov = { size: 'estimated', colour: 'estimated', material: 'estimated', price: 'estimated' };

var w = base.w, d = base.d, h = base.h;

/* size words, then explicit sizes from the link */
var seat = joined.match(/(\d)\s?seater/);
if (seat && base.id === 'sofa') { var sw = { 1: 95, 2: 160, 3: 210, 4: 250 }[seat[1]]; if (sw) { w = sw; prov.size = 'link'; } }
if (base.id === 'bed') {
    for (var k = 0; k < SIZE_WORDS.length; k++) { if (SIZE_WORDS[k].re.test(joined)) { w = SIZE_WORDS[k].w; d = SIZE_WORDS[k].d; prov.size = 'link'; break; } }
}
var dm = path.match(/(\d{2,3})\s?[x×]\s?(\d{2,3})(?:\s?[x×]\s?(\d{2,3}))?/);
if (dm) {
    w = +dm[1]; d = +dm[2]; if (dm[3]) h = +dm[3]; prov.size = 'link';
}

/* colour and material */
var colour = base.color, found = [];
var colourWord = null, matWord = null;
tokens.forEach(function (t) {
    if (!colourWord && COLOURS[t] && !MAT_COLOUR[t]) colourWord = t;
    if (MATERIALS[t] && found.indexOf(MATERIALS[t]) < 0) found.push(MATERIALS[t]);
    if (!matWord && MATERIALS[t]) matWord = t;
});
if (colourWord) { colour = COLOURS[colourWord]; prov.colour = 'link'; }
else if (matWord && MAT_COLOUR[matWord]) { colour = COLOURS[MAT_COLOUR[matWord]]; prov.colour = 'link'; }
var material = base.mat;
if (found.length) { material = found.slice(0, 2).join(' / '); prov.material = 'link'; }

/* shape */
var shape = 'rect';
if (/round|circular|oval/.test(joined) && ['coffee', 'dining', 'rug', 'armchair'].indexOf(base.id) >= 0) shape = 'round';
if (base.id === 'lamp' || base.id === 'plant') shape = 'round';
if (/corner|l shaped|l shape|chaise/.test(joined) && (base.id === 'sofa' || base.id === 'desk')) shape = 'L';
if (shape === 'round') { d = w; }

/* price */
var price, pm = path.match(/(?:£|gbp|price)[-_ ]?(\d{2,5})/);
if (pm) { price = +pm[1]; prov.price = 'link'; }
else { var span = base.price[1] - base.price[0]; price = Math.round((base.price[0] + hash(path) % (span + 1)) / 5) * 5; }

/* name */
var nameToks = [];
for (var n = 0; n < tokens.length; n++) {
    var t = tokens[n];
    if (STOP[t] || /^\d{3,}$/.test(t) || /^\d+x\d+/.test(t) || /^£/.test(t)) continue;
    if (nameToks.length >= 2 && (COLOURS[t] || MATERIALS[t])) break;
    nameToks.push(t);
    if (nameToks.length >= 5) break;
}
var name = nameToks.length ? nameToks.map(cap).join(' ') : base.label;

return {
    id: uid++, name: name, cat: base.id, w: w, d: d, h: h, shape: shape, color: colour, material: material,
    price: price, x: room.w / 2, y: room.l / 2, rot: 0, url: s, retailer: retailer, prov: prov
};
}

function extractedColour(value) {
if (typeof value !== 'string') return null;
var hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
if (hex) {
    var code = hex[1];
    return '#' + (code.length === 3 ? code.split('').map(function (c) { return c + c; }).join('') : code);
}
var words = value.toLowerCase().match(/[a-z]+/g) || [];
for (var i = 0; i < words.length; i++) {
    if (COLOURS[words[i]]) return COLOURS[words[i]];
    if (MAT_COLOUR[words[i]]) return COLOURS[MAT_COLOUR[words[i]]];
}
return null;
}

function applyProductData(item, product) {
if (product.name) item.name = product.name;
if (product.image) item.image = product.image;
var dimensions = [product.widthCm, product.depthCm, product.heightCm];
if (dimensions.every(function (value) { return Number.isFinite(value) && value >= 10 && value <= 500; })) {
    item.w = dimensions[0]; item.d = dimensions[1]; item.h = dimensions[2]; item.prov.size = 'link';
}
if (product.material) { item.material = product.material; item.prov.material = 'link'; }
var color = extractedColour(product.color);
if (color) { item.color = color; item.prov.colour = 'link'; }
if (Number.isFinite(product.price) && product.price >= 0 && (!product.priceCurrency || product.priceCurrency.toUpperCase() === 'GBP')) {
    item.price = product.price; item.prov.price = 'link';
}
return item;
}

function isIkeaHostname(hostname) {
var host = hostname.toLowerCase();
return host === 'ikea.com' || /\.ikea\.com$/.test(host);
}

async function extract(raw, adapters) {
var item = createFurnitureFallback(raw);
if (!item) return null;
if (!isIkeaHostname(new URL(item.url).hostname)) throw new Error('Roomfit currently accepts IKEA product links only.');
var product = await window.RoomfitProductExtractor.extractFurnitureProduct(raw, adapters);
return { item: applyProductData(item, product), imageColorError: product.imageColorError || null };
}

/* =====================================================
    MODULE 3. Room state, collisions, interaction
    ===================================================== */
function corners(it) {
var c = Math.cos(it.rot * DEG), s = Math.sin(it.rot * DEG), hw = it.w / 2, hd = it.d / 2;
return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(function (p) {
    return [it.x + p[0] * c - p[1] * s, it.y + p[0] * s + p[1] * c];
});
}
function satOverlap(A, B) {
var EPS = 0.5;
var polys = [A, B];
for (var pi = 0; pi < 2; pi++) {
    var P = polys[pi];
    for (var i = 0; i < 4; i++) {
    var p1 = P[i], p2 = P[(i + 1) % 4];
    var nx = p1[1] - p2[1], ny = p2[0] - p1[0], len = Math.hypot(nx, ny);
    nx /= len; ny /= len;
    var a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9, q, j;
    for (j = 0; j < 4; j++) { q = A[j][0] * nx + A[j][1] * ny; if (q < a0) a0 = q; if (q > a1) a1 = q; }
    for (j = 0; j < 4; j++) { q = B[j][0] * nx + B[j][1] * ny; if (q < b0) b0 = q; if (q > b1) b1 = q; }
    if (a1 <= b0 + EPS || b1 <= a0 + EPS) return false;
    }
}
return true;
}
function insideRoom(it, poly) {
var cs = corners(it), pts = [];
for (var i = 0; i < 4; i++) {
    var a = cs[i], b = cs[(i + 1) % 4];
    pts.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
}
for (var k = 0; k < pts.length; k++) {
    var dx = it.x - pts[k][0], dy = it.y - pts[k][1], dl = Math.hypot(dx, dy) || 1;
    var test = [pts[k][0] + dx / dl * 0.5, pts[k][1] + dy / dl * 0.5];
    if (!pointInPoly(test, poly)) return false;
}
var c = Math.cos(-it.rot * DEG), s = Math.sin(-it.rot * DEG);
for (var v = 0; v < poly.length; v++) {
    var px = poly[v][0] - it.x, py = poly[v][1] - it.y;
    var lx = px * c - py * s, ly = px * s + py * c;
    if (Math.abs(lx) < it.w / 2 - 0.5 && Math.abs(ly) < it.d / 2 - 0.5) return false;
}
return true;
}
function doorZone() {
var o = roomOpenings(room).door, wd = o.x1 - o.x0, dp = Math.min(90, room.l - 10);
return [[o.x0, o.y - dp], [o.x1, o.y - dp], [o.x1, o.y], [o.x0, o.y]];
}
function computeIssues() {
var poly = roomPoly(room), list = [], bad = {}, dz = doorZone();
items.forEach(function (a, i) {
    if (!insideRoom(a, poly)) { list.push(a.name + ' is outside the walls'); bad[a.id] = true; }
    if (a.cat === 'rug') return;
    if (satOverlap(corners(a), dz)) { list.push(a.name + ' blocks the door'); bad[a.id] = true; }
    for (var j = i + 1; j < items.length; j++) {
    var b = items[j];
    if (b.cat === 'rug') continue;
    if (satOverlap(corners(a), corners(b))) { list.push(a.name + ' overlaps ' + b.name); bad[a.id] = true; bad[b.id] = true; }
    }
});
return { list: list, bad: bad };
}
function getSel() { for (var i = 0; i < items.length; i++) if (items[i].id === selId) return items[i]; return null; }
function freeSpot(it) {
var step = 20, poly = roomPoly(room);
for (var y = it.d / 2 + 10; y < room.l; y += step) {
    for (var x = it.w / 2 + 10; x < room.w; x += step) {
    var t = { x: x, y: y, w: it.w, d: it.d, rot: 0 };
    if (!insideRoom(t, poly)) continue;
    var ok = true;
    for (var i = 0; i < items.length && ok; i++) {
        if (items[i].cat === 'rug' || it.cat === 'rug') continue;
        if (satOverlap(corners(t), corners(items[i]))) ok = false;
    }
    if (ok && !satOverlap(corners(t), doorZone())) return [x, y];
    }
}
return [room.w / 2, room.l / 2];
}

/* ---------- 2D plan ---------- */
var cv = $('#plan'), ctx = cv.getContext('2d');
var V = { W: 600, H: 420, sc: 1, ox: 0, oy: 0 };
function sizePlan() {
var box = $('#planBox'), w = box.clientWidth || 600;
var h = clamp(Math.round(w * 0.72), 320, 640);
var dpr = window.devicePixelRatio || 1;
cv.style.height = h + 'px';
cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
V.W = w; V.H = h; V.dpr = dpr;
var pad = 48;
V.sc = Math.min((w - pad * 2) / room.w, (h - pad * 2) / room.l);
V.ox = (w - room.w * V.sc) / 2; V.oy = (h - room.l * V.sc) / 2;
}
function sx(x) { return V.ox + x * V.sc; }
function sy(y) { return V.oy + y * V.sc; }
function zOrder() {
var rugs = items.filter(function (i) { return i.cat === 'rug' && i.id !== selId; });
var rest = items.filter(function (i) { return i.cat !== 'rug' && i.id !== selId; });
var sel = getSel();
return rugs.concat(rest, sel ? [sel] : []);
}
function itemPath(it) {
/* local frame, origin at centre, in screen pixels */
var hw = it.w / 2 * V.sc, hd = it.d / 2 * V.sc;
ctx.beginPath();
if (it.shape === 'round') { ctx.ellipse(0, 0, hw, hd, 0, 0, Math.PI * 2); }
else if (it.shape === 'L') {
    var cw = it.w * 0.45 * V.sc, cd = it.d * 0.5 * V.sc;
    ctx.moveTo(-hw, -hd); ctx.lineTo(hw - cw, -hd); ctx.lineTo(hw - cw, -hd + cd);
    ctx.lineTo(hw, -hd + cd); ctx.lineTo(hw, hd); ctx.lineTo(-hw, hd); ctx.closePath();
} else { ctx.rect(-hw, -hd, hw * 2, hd * 2); }
}
function drawPlan() {
var poly = roomPoly(room), op = roomOpenings(room), iss = computeIssues();
ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
ctx.clearRect(0, 0, V.W, V.H);
ctx.fillStyle = cssv('--surface'); ctx.fillRect(0, 0, V.W, V.H);

/* floor + grid */
ctx.save();
ctx.beginPath(); poly.forEach(function (p, i) { i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])); }); ctx.closePath();
ctx.fillStyle = cssv('--floor'); ctx.fill(); ctx.clip();
ctx.strokeStyle = cssv('--grid'); ctx.lineWidth = 1;
for (var gx = 0; gx <= room.w; gx += 50) { ctx.globalAlpha = gx % 100 === 0 ? 1 : 0.5; ctx.beginPath(); ctx.moveTo(sx(gx), sy(0)); ctx.lineTo(sx(gx), sy(room.l)); ctx.stroke(); }
for (var gy = 0; gy <= room.l; gy += 50) { ctx.globalAlpha = gy % 100 === 0 ? 1 : 0.5; ctx.beginPath(); ctx.moveTo(sx(0), sy(gy)); ctx.lineTo(sx(room.w), sy(gy)); ctx.stroke(); }
ctx.restore(); ctx.globalAlpha = 1;

/* walls */
ctx.beginPath(); poly.forEach(function (p, i) { i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])); }); ctx.closePath();
ctx.strokeStyle = room.wallColor; ctx.lineWidth = 6; ctx.lineJoin = 'miter'; ctx.stroke();

/* window */
ctx.strokeStyle = cssv('--accent'); ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(sx(op.win.x0), sy(op.win.y)); ctx.lineTo(sx(op.win.x1), sy(op.win.y)); ctx.stroke();
ctx.strokeStyle = cssv('--floor'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(op.win.x0), sy(op.win.y)); ctx.lineTo(sx(op.win.x1), sy(op.win.y)); ctx.stroke();

/* door gap and swing */
var dw = op.door.x1 - op.door.x0;
ctx.strokeStyle = cssv('--floor'); ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(sx(op.door.x0), sy(op.door.y)); ctx.lineTo(sx(op.door.x1), sy(op.door.y)); ctx.stroke();
ctx.strokeStyle = cssv('--muted'); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
ctx.beginPath(); ctx.arc(sx(op.door.x0), sy(op.door.y), dw * V.sc, -Math.PI / 2, 0); ctx.stroke(); ctx.setLineDash([]);
ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(op.door.x0), sy(op.door.y)); ctx.lineTo(sx(op.door.x0), sy(op.door.y - dw)); ctx.stroke();

/* dimension labels */
ctx.fillStyle = cssv('--muted'); ctx.font = '500 12px ' + cssv('--font-mono'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
ctx.fillText((room.w / 100).toFixed(2) + ' m', sx(room.w / 2), V.oy - 20);
ctx.save(); ctx.translate(V.ox - 22, sy(room.l / 2)); ctx.rotate(-Math.PI / 2); ctx.fillText((room.l / 100).toFixed(2) + ' m', 0, 0); ctx.restore();

/* furniture */
zOrder().forEach(function (it) {
    var bad = iss.bad[it.id], sel = it.id === selId;
    ctx.save();
    ctx.translate(sx(it.x), sy(it.y)); ctx.rotate(it.rot * DEG);
    itemPath(it);
    ctx.globalAlpha = it.cat === 'rug' ? 0.7 : 0.94; ctx.fillStyle = it.color; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = bad ? 2.5 : 1.2; ctx.strokeStyle = bad ? cssv('--warn') : 'rgba(0,0,0,0.45)';
    if (bad) ctx.setLineDash([6, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    /* front notch */
    var hd = it.d / 2 * V.sc, nw = Math.min(14, it.w / 2 * V.sc * 0.5);
    if (it.cat !== 'rug') {
    ctx.fillStyle = lum(it.color) > 150 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.moveTo(-nw, hd - 1); ctx.lineTo(nw, hd - 1); ctx.lineTo(0, hd - 1 - Math.min(8, hd * 0.5)); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    /* label */
    var pw = it.w * V.sc, ph = it.d * V.sc;
    var fs = clamp(V.sc * 10, 10, 13);
    ctx.font = '600 ' + fs + 'px ' + cssv('--font-body');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = lum(it.color) > 150 ? '#16201C' : '#FFFFFF';
    var label = it.name, maxw = Math.max(pw, ph) * 0.9;
    if (Math.min(pw, ph) >= 22 || it.cat === 'lamp') {
    while (label.length > 3 && ctx.measureText(label).width > maxw) label = label.slice(0, -2);
    if (label !== it.name) label += '…';
    if (Math.max(pw, ph) >= 44) {
        var vertical = ph > pw * 1.6;
        ctx.save(); ctx.translate(sx(it.x), sy(it.y));
        if (vertical) ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, -fs * 0.5);
        ctx.font = '400 ' + (fs - 1) + 'px ' + cssv('--font-mono');
        ctx.fillText(Math.round(it.w) + '×' + Math.round(it.d), 0, fs * 0.7);
        ctx.restore();
    }
    }

    if (sel) {
    ctx.save(); ctx.translate(sx(it.x), sy(it.y)); ctx.rotate(it.rot * DEG);
    ctx.strokeStyle = cssv('--accent'); ctx.lineWidth = 2.5;
    var hw2 = it.w / 2 * V.sc + 3, hd2 = it.d / 2 * V.sc + 3;
    ctx.strokeRect(-hw2, -hd2, hw2 * 2, hd2 * 2);
    ctx.fillStyle = cssv('--accent');
    [[-hw2, -hd2], [hw2, -hd2], [hw2, hd2], [-hw2, hd2]].forEach(function (c) { ctx.fillRect(c[0] - 3, c[1] - 3, 6, 6); });
    ctx.restore();
    }
});
}

function toRoom(ev) {
var r = cv.getBoundingClientRect();
return [(ev.clientX - r.left - V.ox) / V.sc, (ev.clientY - r.top - V.oy) / V.sc];
}
function hitItem(p) {
var order = zOrder().reverse();
var nonRug = order.filter(function (i) { return i.cat !== 'rug'; }), rugs = order.filter(function (i) { return i.cat === 'rug'; });
var sel = getSel(), cand = (sel && sel.cat !== 'rug' ? [sel] : []).concat(nonRug, rugs);
for (var i = 0; i < cand.length; i++) {
    var it = cand[i], c = Math.cos(-it.rot * DEG), s = Math.sin(-it.rot * DEG);
    var dx = p[0] - it.x, dy = p[1] - it.y, lx = dx * c - dy * s, ly = dx * s + dy * c;
    if (Math.abs(lx) <= it.w / 2 && Math.abs(ly) <= it.d / 2) return it;
}
return null;
}
var drag = null;
function snapV(v) { return $('#snap').checked ? Math.round(v / 5) * 5 : Math.round(v * 10) / 10; }
cv.addEventListener('pointerdown', function (ev) {
cv.focus({ preventScroll: true });
var p = toRoom(ev), it = hitItem(p);
if (it) {
    selId = it.id; drag = { id: it.id, dx: it.x - p[0], dy: it.y - p[1] };
    cv.setPointerCapture(ev.pointerId);
} else { selId = null; }
renderList(); fillEditor(); drawPlan();
});
cv.addEventListener('pointermove', function (ev) {
if (!drag) return;
var it = getSel(); if (!it) return;
var p = toRoom(ev);
it.x = clamp(snapV(p[0] + drag.dx), -50, room.w + 50);
it.y = clamp(snapV(p[1] + drag.dy), -50, room.l + 50);
moved();
});
function endDrag(ev) { if (drag) { drag = null; try { cv.releasePointerCapture(ev.pointerId); } catch (e) {} renderList(); } }
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('keydown', function (ev) {
var it = getSel(); if (!it) return;
var step = ev.shiftKey ? 25 : 5, handled = true;
if (ev.key === 'ArrowLeft') it.x -= step;
else if (ev.key === 'ArrowRight') it.x += step;
else if (ev.key === 'ArrowUp') it.y -= step;
else if (ev.key === 'ArrowDown') it.y += step;
else if (ev.key === 'r' || ev.key === 'R') it.rot = (it.rot + (ev.shiftKey ? 90 : 15)) % 360;
else if (ev.key === 'Delete' || ev.key === 'Backspace') { removeItem(it.id); ev.preventDefault(); return; }
else handled = false;
if (handled) { ev.preventDefault(); moved(); renderList(); fillEditor(true); }
});

/* ---------- UI: stats, list, editor ---------- */
function updateStats() {
var area = polyArea(roomPoly(room));
var foot = 0, cost = 0;
items.forEach(function (i) { if (i.cat !== 'rug') foot += i.w * i.d; cost += +i.price || 0; });
var iss = computeIssues();
$('#stArea').innerHTML = (area / 10000).toFixed(1) + ' <small>m²</small>';
$('#stCover').innerHTML = Math.round(foot / area * 100) + ' <small>%</small>';
$('#stCost').textContent = gbp(cost);
$('#stIssues').textContent = iss.list.length;
$('#stIssues').style.color = iss.list.length ? cssv('--warn') : cssv('--good');
var ul = $('#issues'); ul.innerHTML = '';
if (!items.length) return;
if (!iss.list.length) { var f = document.createElement('li'); f.className = 'fine'; f.textContent = 'Everything fits. Nothing overlaps, and the door stays clear.'; ul.appendChild(f); }
iss.list.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
}
function renderList() {
var ul = $('#itemList'); ul.innerHTML = '';
$('#itemEmpty').hidden = items.length > 0;
var iss = computeIssues();
items.forEach(function (it) {
    var li = document.createElement('li'); li.className = 'item'; li.tabIndex = 0;
    if (it.id === selId) li.setAttribute('aria-current', 'true');
    var thumb = document.createElement('span'); thumb.className = 'thumb'; thumb.setAttribute('aria-hidden', 'true');
    if (it.image) {
        var imageUrl;
        try {
            var parsedImage = new URL(it.image);
            if ((parsedImage.protocol === 'http:' || parsedImage.protocol === 'https:') && isIkeaHostname(parsedImage.hostname)) {
                imageUrl = parsedImage.href;
            }
        } catch (error) {
            imageUrl = null;
        }
        if (imageUrl) {
            var image = document.createElement('img');
            image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
            image.src = '/api/fetch-image?url=' + encodeURIComponent(imageUrl);
            image.addEventListener('error', function () { thumb.classList.add('unavailable'); image.remove(); });
            thumb.appendChild(image);
        }
    }
    var sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = it.color;
    var mid = document.createElement('div'); mid.style.minWidth = '0';
    var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.name;
    var meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = Math.round(it.w) + '×' + Math.round(it.d) + '×' + Math.round(it.h) + ' cm · ' + it.material;
    mid.appendChild(nm); mid.appendChild(meta);
    var pr = document.createElement('span'); pr.className = 'pr'; pr.textContent = gbp(it.price);
    var dot = document.createElement('span'); dot.className = 'dot' + (iss.bad[it.id] ? ' bad' : ''); dot.title = iss.bad[it.id] ? 'Has a problem' : 'Fits';
    li.appendChild(thumb); li.appendChild(sw); li.appendChild(mid); li.appendChild(pr); li.appendChild(dot);
    var pick = function () { selId = it.id; renderList(); fillEditor(); drawPlan(); };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    ul.appendChild(li);
});
}
var E = {
name: $('#ed-name'), mat: $('#ed-mat'), w: $('#ed-w'), d: $('#ed-d'), h: $('#ed-h'), price: $('#ed-price'),
color: $('#ed-color'), shape: $('#ed-shape'), rot: $('#ed-rot')
};
function fillEditor(keepFocus) {
var it = getSel();
$('#edEmpty').hidden = !!it; $('#edBody').hidden = !it;
if (!it) return;
if (!keepFocus || document.activeElement === cv) {
    E.name.value = it.name; E.mat.value = it.material; E.w.value = Math.round(it.w); E.d.value = Math.round(it.d);
    E.h.value = Math.round(it.h); E.price.value = it.price; E.color.value = it.color; E.shape.value = it.shape;
}
E.rot.value = Math.round(it.rot); $('#rotVal').textContent = Math.round(it.rot) + '°';
var b = $('#badges'); b.innerHTML = '';
[['size', 'Size'], ['colour', 'Colour'], ['material', 'Material'], ['price', 'Price']].forEach(function (f) {
    var s = document.createElement('span'); var fromLink = it.prov[f[0]] === 'link';
    s.className = 'badge' + (fromLink ? ' link' : ''); s.textContent = f[1] + (fromLink ? ' read from link' : ' estimated');
    b.appendChild(s);
});
$('#edSrc').textContent = it.retailer + ' · ' + it.url;
}
function bindEditor() {
function upd(fn) { return function () { var it = getSel(); if (!it) return; fn(it); edited(); }; }
E.name.addEventListener('input', upd(function (it) { it.name = E.name.value || 'Piece'; }));
E.mat.addEventListener('input', upd(function (it) { it.material = E.mat.value; it.prov.material = 'estimated'; }));
E.w.addEventListener('input', upd(function (it) { var v = +E.w.value; if (v >= 10) { it.w = v; it.prov.size = 'estimated'; if (it.shape === 'round') { it.d = v; E.d.value = v; } } }));
E.d.addEventListener('input', upd(function (it) { var v = +E.d.value; if (v >= 10) { it.d = v; it.prov.size = 'estimated'; } }));
E.h.addEventListener('input', upd(function (it) { var v = +E.h.value; if (v >= 1) it.h = v; }));
E.price.addEventListener('input', upd(function (it) { it.price = Math.max(0, +E.price.value || 0); it.prov.price = 'estimated'; }));
E.color.addEventListener('input', upd(function (it) { it.color = E.color.value; it.prov.colour = 'estimated'; }));
E.shape.addEventListener('change', upd(function (it) { it.shape = E.shape.value; if (it.shape === 'round') { it.d = it.w; E.d.value = Math.round(it.d); } }));
E.rot.addEventListener('input', upd(function (it) { it.rot = +E.rot.value; $('#rotVal').textContent = it.rot + '°'; }));
$('#rotL').addEventListener('click', upd(function (it) { it.rot = (it.rot + 270) % 360; E.rot.value = it.rot; $('#rotVal').textContent = it.rot + '°'; }));
$('#rotR').addEventListener('click', upd(function (it) { it.rot = (it.rot + 90) % 360; E.rot.value = it.rot; $('#rotVal').textContent = it.rot + '°'; }));
$('#delBtn').addEventListener('click', function () { var it = getSel(); if (it) removeItem(it.id); });
}
function removeItem(id) {
items = items.filter(function (i) { return i.id !== id; });
if (selId === id) selId = null;
edited(); fillEditor();
}

function moved() { drawPlan(); updateStats(); renderList_light(); sync3D(); }
function renderList_light() { /* keep list dots current while dragging */
var iss = computeIssues(), rows = document.querySelectorAll('#itemList .item');
rows.forEach(function (row, i) { var d = row.querySelector('.dot'); if (d && items[i]) d.className = 'dot' + (iss.bad[items[i].id] ? ' bad' : ''); });
}
function edited() { renderList(); drawPlan(); updateStats(); rebuild3D(); }
function roomChanged() {
var area = polyArea(roomPoly(room)) / 10000;
$('#roomSummary').textContent = (room.w / 100).toFixed(1) + ' × ' + (room.l / 100).toFixed(1) + ' m, ' + (room.h / 100).toFixed(2) + ' m ceiling · ' + area.toFixed(1) + ' m² of floor';
sizePlan(); edited();
}

/* ---------- room form ---------- */
function readRoom() {
var w = +$('#rw').value, l = +$('#rl').value, h = +$('#rh').value;
if (!(w >= 200 && w <= 1200 && l >= 200 && l <= 1200 && h >= 200 && h <= 400)) return;
room.w = w; room.l = l; room.h = h;
var sh = document.querySelector('input[name=shape]:checked'); room.shape = sh ? sh.value : 'rect';
roomChanged();
}
function readWallColor() {
var input = $('#wallColor'), value = input.value.trim();
var valid = /^#[0-9a-f]{6}$/i.test(value);
input.setCustomValidity(valid ? '' : 'Enter a six-digit hex colour, e.g. #2B3A35.');
input.setAttribute('aria-invalid', String(!valid));
$('#wallColorError').hidden = valid;
if (!valid) return;
room.wallColor = value.toUpperCase();
drawPlan();
if (T.ready) rebuild3D();
}
function readWallTransparency() {
room.transparentWalls = $('#transparentWalls').checked;
if (T.ready) rebuild3D();
}
['#rw', '#rl', '#rh'].forEach(function (s) { $(s).addEventListener('input', readRoom); });
document.querySelectorAll('input[name=shape]').forEach(function (r) { r.addEventListener('change', readRoom); });
$('#wallColor').addEventListener('input', readWallColor);
$('#transparentWalls').addEventListener('change', readWallTransparency);

/* ---------- link extraction UI ---------- */
function logLine(text, cls) { var li = document.createElement('li'); if (cls) li.className = cls; li.textContent = text; $('#log').appendChild(li); $('#log').scrollTop = 1e6; return li; }
function apiRequest(path, payload) {
return fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload)
}).then(async function (response) {
    var responseText = await response.text();
    var body;
    try {
        body = JSON.parse(responseText);
    } catch (error) {
        var preview = responseText.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!response.ok) throw new Error('Extraction server returned HTTP ' + response.status + (preview ? ': ' + preview : '.'));
        throw new Error('Extraction server returned a non-JSON response' + (preview ? ': ' + preview : '.'));
    }
    if (!response.ok) throw new Error(body.error || 'The extraction service returned HTTP ' + response.status + '.');
    return body;
});
}
var busy = false;
$('#extractBtn').addEventListener('click', async function () {
if (busy) return;
var lines = $('#links').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
$('#log').innerHTML = '';
if (!lines.length) { logLine('Paste at least one furniture link first.', 'err'); return; }
busy = true; this.disabled = true; this.textContent = 'Reading links…';
var added = 0;
var button = this;
try {
    if (!window.RoomfitProductExtractor) throw new Error('Product extractor did not load. Reload the page and try again.');
    if (window.location.protocol === 'file:') {
        throw new Error('Roomfit is opened as a local file. Start server.js and open http://127.0.0.1:3000 to use product extraction.');
    }
    var config = await apiRequest('/api/config');
    if (!config.pageFetcherConfigured) throw new Error('The IKEA page fetcher is unavailable. Restart the Roomfit server and try again.');
    var adapters = {
        fetchPage: function (url) { return apiRequest('/api/fetch-page', { url: url }); },
        fetchImage: async function (url) {
            var response = await fetch('/api/fetch-image?url=' + encodeURIComponent(url));
            if (!response.ok) {
                var body;
                try { body = await response.json(); } catch (error) { body = null; }
                throw new Error(body && body.error ? body.error : 'The IKEA image service returned HTTP ' + response.status + '.');
            }
            return response.blob();
        },
        extractStructured: config.llmConfigured
            ? function (input) { return apiRequest('/api/extract-structured', input); }
            : null
    };
    for (var i = 0; i < lines.length; i++) {
        var short = lines[i].replace(/^https?:\/\//, '').slice(0, 48);
        logLine('Reading ' + short + '…');
        try {
            var extraction = await extract(lines[i], adapters);
            if (!extraction) throw new Error('Enter a valid product URL.');
            var it = extraction.item;
            var spot = freeSpot(it); it.x = spot[0]; it.y = spot[1];
            items.push(it); selId = it.id; added++;
            logLine('Added ' + it.name + ' · ' + Math.round(it.w) + '×' + Math.round(it.d) + '×' + Math.round(it.h) + ' cm · ' + it.material + ' · ' + gbp(it.price), 'ok');
            if (extraction.imageColorError) logLine('Image colour was not detected; using the available colour fallback. ' + extraction.imageColorError, 'err');
            edited(); fillEditor();
        } catch (error) {
            logLine('Could not extract "' + short + '": ' + error.message, 'err');
        }
    }
    if (added) $('#links').value = '';
} catch (error) {
    logLine(error.message, 'err');
} finally {
    busy = false; button.disabled = false; button.textContent = 'Extract details';
}
});

/* ---------- initial room ---------- */
function resetRoom() {
uid = 1; items = []; selId = null;
var defaultWallColor = cssv('--wall') || '#2B3A35';
room = { shape: 'rect', w: 420, l: 360, h: 250, wallColor: defaultWallColor, transparentWalls: true };
$('#rw').value = 420; $('#rl').value = 360; $('#rh').value = 250; $('#sh-rect').checked = true;
$('#wallColor').value = defaultWallColor.toUpperCase();
$('#wallColor').setCustomValidity(''); $('#wallColor').setAttribute('aria-invalid', 'false'); $('#wallColorError').hidden = true;
$('#transparentWalls').checked = true;
roomChanged(); fillEditor();
}
$('#resetBtn').addEventListener('click', resetRoom);

/* =====================================================
    3D view (three.js)
    ===================================================== */
var T = { ready: false, groups: {}, root: null };
var orbit = { az: 0.75, pol: 1.0, dist: 700 };
function box3(g, w, h, d, x, y, z, color) {
var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: color }));
m.position.set(x, y + h / 2, z);
m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })));
g.add(m); return m;
}
function cyl3(g, rt, rb, h, x, y, z, color, extra) {
var mat = new THREE.MeshLambertMaterial({ color: color });
if (extra && extra.emissive) { mat.emissive = new THREE.Color(extra.emissive); }
var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 28), mat);
m.position.set(x, y + h / 2, z); g.add(m); return m;
}
function shade(hex, f) { var c = new THREE.Color(hex); c.multiplyScalar(f); return c; }
function build3DItem(it) {
var g = new THREE.Group(), w = it.w, d = it.d, h = it.h, col = new THREE.Color(it.color), dark = shade(it.color, 0.75), light = shade(it.color, 1.15);
var cat = it.cat, round = it.shape === 'round', L = it.shape === 'L';
if (cat === 'sofa' || cat === 'armchair') {
    if (L) {
    var cw = w * 0.45, cd = d * 0.5;
    box3(g, w - cw, h * 0.45, d, -cw / 2, 0, 0, col);
    box3(g, w, h * 0.45, d - cd, 0, 0, cd / 2, col);
    box3(g, w - cw, h, d * 0.22, -cw / 2, 0, -d / 2 + d * 0.11, col);
    box3(g, w * 0.08, h * 0.62, d, -w / 2 + w * 0.04, 0, 0, dark);
    } else {
    box3(g, w, h * 0.45, d * 0.94, 0, 0, d * 0.03, col);
    box3(g, w, h, d * 0.24, 0, 0, -d / 2 + d * 0.12, col);
    box3(g, w * 0.1, h * 0.62, d, -(w / 2 - w * 0.05), 0, 0, dark);
    box3(g, w * 0.1, h * 0.62, d, (w / 2 - w * 0.05), 0, 0, dark);
    box3(g, w * 0.76, h * 0.1, d * 0.6, 0, h * 0.45, d * 0.1, light);
    }
} else if (cat === 'bed') {
    box3(g, w, h * 0.28, d, 0, 0, 0, dark);
    box3(g, w * 0.96, h * 0.22, d * 0.94, 0, h * 0.28, d * 0.02, col);
    box3(g, w, h, d * 0.04, 0, 0, -d / 2 + d * 0.02, dark);
    box3(g, w * 0.38, h * 0.08, d * 0.14, -w * 0.22, h * 0.5, -d / 2 + d * 0.16, 0xF1EEE8);
    box3(g, w * 0.38, h * 0.08, d * 0.14, w * 0.22, h * 0.5, -d / 2 + d * 0.16, 0xF1EEE8);
} else if (cat === 'coffee' || cat === 'dining' || cat === 'desk') {
    var t = Math.max(3, h * 0.07);
    if (round) {
    cyl3(g, w / 2, w / 2, t, 0, h - t, 0, col);
    cyl3(g, w * 0.05, w * 0.12, h - t, 0, 0, 0, dark);
    } else {
    box3(g, w, t, d, 0, h - t, 0, col);
    var lx = w / 2 - 4, lz = d / 2 - 4;
    [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].forEach(function (p) { box3(g, 4, h - t, 4, p[0], 0, p[1], dark); });
    }
} else if (cat === 'chair') {
    box3(g, w, h * 0.07, d, 0, h * 0.46, 0, col);
    box3(g, w, h * 0.5, d * 0.1, 0, h * 0.5, -d / 2 + d * 0.05, col);
    var cx = w / 2 - 3, cz = d / 2 - 3;
    [[-cx, -cz], [cx, -cz], [-cx, cz], [cx, cz]].forEach(function (p) { box3(g, 3, h * 0.46, 3, p[0], 0, p[1], dark); });
} else if (cat === 'wardrobe') {
    box3(g, w, h, d, 0, 0, 0, col);
    box3(g, 1.5, h * 0.92, 1, 0, h * 0.04, d / 2 + 0.4, dark);
    box3(g, 3, 14, 2, -5, h * 0.45, d / 2 + 1, dark); box3(g, 3, 14, 2, 5, h * 0.45, d / 2 + 1, dark);
} else if (cat === 'bookcase') {
    box3(g, w, h, 2, 0, 0, -d / 2 + 1, dark);
    box3(g, 2, h, d, -(w / 2 - 1), 0, 0, col); box3(g, 2, h, d, w / 2 - 1, 0, 0, col);
    for (var s = 0; s < 5; s++) box3(g, w, 2, d, 0, s * (h - 2) / 4, 0, col);
} else if (cat === 'sideboard') {
    box3(g, w, h * 0.8, d, 0, h * 0.2, 0, col);
    var sx2 = w / 2 - 5, sz2 = d / 2 - 4;
    [[-sx2, -sz2], [sx2, -sz2], [-sx2, sz2], [sx2, sz2]].forEach(function (p) { box3(g, 4, h * 0.2, 4, p[0], 0, p[1], dark); });
    box3(g, 1.2, h * 0.7, 1, -w / 6, h * 0.25, d / 2 + 0.4, dark); box3(g, 1.2, h * 0.7, 1, w / 6, h * 0.25, d / 2 + 0.4, dark);
} else if (cat === 'lamp') {
    cyl3(g, w * 0.3, w * 0.3, 2, 0, 0, 0, col);
    cyl3(g, 1.2, 1.2, h * 0.84, 0, 0, 0, col);
    cyl3(g, w * 0.3, w * 0.46, h * 0.2, 0, h * 0.8, 0, 0xF4E9C8, { emissive: 0x5A4E2A });
} else if (cat === 'rug') {
    if (round) cyl3(g, w / 2, w / 2, 1.5, 0, 0, 0, col); else box3(g, w, 1.5, d, 0, 0, 0, col);
} else if (cat === 'plant') {
    cyl3(g, w * 0.28, w * 0.2, h * 0.28, 0, 0, 0, 0xB5A58F);
    var f = new THREE.Mesh(new THREE.SphereGeometry(w * 0.5, 16, 12), new THREE.MeshLambertMaterial({ color: col }));
    f.position.set(0, h * 0.28 + w * 0.45, 0); f.scale.set(1, 1.4, 1); g.add(f);
} else if (L) {
    var cw2 = w * 0.45, cd2 = d * 0.5;
    box3(g, w - cw2, h, d, -cw2 / 2, 0, 0, col); box3(g, w, h, d - cd2, 0, 0, cd2 / 2, col);
} else if (round) { cyl3(g, w / 2, w / 2, h, 0, 0, 0, col); }
else { box3(g, w, h, d, 0, 0, 0, col); }
return g;
}
function clearGroup(g) {
while (g.children.length) {
    var c = g.children[0]; g.remove(c);
    c.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}
}
function init3D() {
if (T.ready) return true;
if (!window.THREE) { $('#three').innerHTML = '<div class="fallback">The 3D library could not load. Check your connection and reload the page. The floor plan still works.</div>'; return false; }
var el = $('#three');
T.renderer = new THREE.WebGLRenderer({ antialias: true });
T.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
el.appendChild(T.renderer.domElement);
T.scene = new THREE.Scene();
T.camera = new THREE.PerspectiveCamera(45, 1, 5, 6000);
T.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
var dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(300, 700, 400); T.scene.add(dl);
T.root = new THREE.Group(); T.scene.add(T.root);
T.roomG = new THREE.Group(); T.itemsG = new THREE.Group(); T.root.add(T.roomG, T.itemsG);
var down = null;
var dom = T.renderer.domElement;
dom.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); });
dom.addEventListener('pointermove', function (e) {
    if (!down) return;
    orbit.az -= (e.clientX - down.x) * 0.008; orbit.pol = clamp(orbit.pol - (e.clientY - down.y) * 0.006, 0.12, 1.5);
    down = { x: e.clientX, y: e.clientY }; render3D();
});
dom.addEventListener('pointerup', function () { down = null; });
dom.addEventListener('pointercancel', function () { down = null; });
dom.addEventListener('wheel', function (e) { e.preventDefault(); orbit.dist = clamp(orbit.dist * (1 + e.deltaY * 0.001), 200, 2600); render3D(); }, { passive: false });
T.ready = true;
return true;
}
function size3D() {
if (!T.ready) return;
var el = $('#three'), w = el.clientWidth || 600, h = clamp(Math.round(w * 0.62), 340, 600);
el.style.height = h + 'px';
T.renderer.setSize(w, h); T.camera.aspect = w / h; T.camera.updateProjectionMatrix();
}
function rebuild3D() {
if (!T.ready) return;
clearGroup(T.roomG); clearGroup(T.itemsG); T.groups = {};
var poly = roomPoly(room), cx = room.w / 2, cy = room.l / 2, H = room.h;
/* floor */
var shp = new THREE.Shape(poly.map(function (p) { return new THREE.Vector2(p[0] - cx, -(p[1] - cy)); }));
var fg = new THREE.ShapeGeometry(shp); fg.rotateX(-Math.PI / 2);
var floor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: new THREE.Color(cssv('--floor')), side: THREE.DoubleSide }));
T.roomG.add(floor);
/* walls */
var wallCol = new THREE.Color(room.wallColor);
for (var i = 0; i < poly.length; i++) {
    var a = poly[i], b = poly[(i + 1) % poly.length];
    var dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
    var wallOpacity = room.transparentWalls ? 0.22 : 1;
    var wm = new THREE.Mesh(new THREE.BoxGeometry(len, H, 8), new THREE.MeshLambertMaterial({
        color: wallCol, transparent: room.transparentWalls, opacity: wallOpacity, depthWrite: !room.transparentWalls
    }));
    wm.position.set((a[0] + b[0]) / 2 - cx, H / 2, (a[1] + b[1]) / 2 - cy); wm.rotation.y = -ang;
    wm.add(new THREE.LineSegments(new THREE.EdgesGeometry(wm.geometry), new THREE.LineBasicMaterial({
        color: wallCol, transparent: room.transparentWalls, opacity: room.transparentWalls ? 0.6 : 1
    })));
    T.roomG.add(wm);
}
var op = roomOpenings(room);
var win = new THREE.Mesh(new THREE.BoxGeometry(op.win.x1 - op.win.x0, 110, 10), new THREE.MeshLambertMaterial({ color: 0x7FB8D8, transparent: true, opacity: 0.55 }));
win.position.set((op.win.x0 + op.win.x1) / 2 - cx, 95 + 55, op.win.y - cy); T.roomG.add(win);
var door = new THREE.Mesh(new THREE.BoxGeometry(op.door.x1 - op.door.x0, 205, 10), new THREE.MeshLambertMaterial({ color: 0xA9805A }));
door.position.set((op.door.x0 + op.door.x1) / 2 - cx, 102.5, op.door.y - cy); T.roomG.add(door);
/* furniture */
items.forEach(function (it) { var g = build3DItem(it); T.itemsG.add(g); T.groups[it.id] = g; });
orbit.dist = clamp(Math.max(room.w, room.l) * 1.5, 450, 2200);
sync3D(true);
}

function sync3D(noRender) {
if (!T.ready) return;
var cx = room.w / 2, cy = room.l / 2;
items.forEach(function (it) {
    var g = T.groups[it.id]; if (!g) return;
    g.position.set(it.x - cx, 0, it.y - cy); g.rotation.y = -it.rot * DEG;
});
if (!noRender) render3D();
else render3D();
}
function render3D() {
if (!T.ready || $('#threeBox').hidden) return;
var bg = cssv('--surface'); T.scene.background = new THREE.Color(bg);
var tx = 0, ty = room.h * 0.15, tz = 0;
T.camera.position.set(tx + orbit.dist * Math.sin(orbit.pol) * Math.sin(orbit.az), ty + orbit.dist * Math.cos(orbit.pol), tz + orbit.dist * Math.sin(orbit.pol) * Math.cos(orbit.az));
T.camera.lookAt(tx, ty, tz);
T.renderer.render(T.scene, T.camera);
}

/* ---------- tabs ---------- */
function showTab(which) {
var plan = which === 'plan';
$('#planBox').hidden = !plan; $('#threeBox').hidden = plan;
$('#tab-plan').setAttribute('aria-selected', plan); $('#tab-3d').setAttribute('aria-selected', !plan);
$('#stageHint').textContent = plan
    ? 'Drag a piece to move it. With a piece selected: arrow keys nudge, R rotates 15°, Delete removes. The notch on each piece marks its front.'
    : 'Drag to orbit, scroll to zoom. Switch back to the floor plan to move pieces.';
if (plan) { sizePlan(); drawPlan(); }
else if (init3D()) { size3D(); rebuild3D(); }
}
$('#tab-plan').addEventListener('click', function () { showTab('plan'); });
$('#tab-3d').addEventListener('click', function () { showTab('3d'); });

window.addEventListener('resize', function () { if (!$('#planBox').hidden) { sizePlan(); drawPlan(); } else { size3D(); render3D(); } });
if (window.matchMedia) {
var mq = window.matchMedia('(prefers-color-scheme: dark)');
var onTheme = function () { drawPlan(); updateStats(); if (T.ready) rebuild3D(); };
if (mq.addEventListener) mq.addEventListener('change', onTheme);
}
new MutationObserver(function () { drawPlan(); updateStats(); if (T.ready) rebuild3D(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ---------- boot ---------- */
bindEditor();
resetRoom();
if (window.ResizeObserver) new ResizeObserver(function () { if (!$('#planBox').hidden) { sizePlan(); drawPlan(); } }).observe($('#planBox'));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawPlan(); });
})();

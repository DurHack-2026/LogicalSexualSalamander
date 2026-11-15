# LogicalSexualSalamander

Website where users enter links to furniture items as well as the dimensions of the room.
The AI will get the dimensions, shape, price, materials, colour from the links.
The user can then move the furniture about in a virtual room to see how it fits and if they like it.
Room settings also let users enter a hex wall colour, toggle transparent walls in the 3D view, and choose a wood, carpet, or marble floor texture.

Tasks:
- Generating the virtual room
- getting the furniture data from the links
- Handling of the virtual room and interactions

## Run the app and configure extraction

Use Node.js 20.6 or newer. For metadata/spec parsing without an LLM, run:

```sh
node server.js
```

Open `http://127.0.0.1:3000`. The room starts empty; paste IKEA product URLs one per line and select **Extract details**. The server fetches IKEA product pages directly using standard HTTP requests and only follows redirects to IKEA domains. It does not attempt to bypass access restrictions; if IKEA returns an error such as HTTP 403, use a permitted access method or check the retailer's terms.

## GitHub Pages

The static room editor and 2D/3D room views can be hosted on GitHub Pages. Pages serves `index.html`, which forwards to `Roomfit.html`. Product-link extraction is not available from Pages alone: it calls the `/api/` endpoints in `server.js`, and GitHub Pages cannot run that Node server. To enable extraction, deploy the API separately, update the frontend to call its URL, and configure the API's CORS policy; keep provider credentials on the server.

Select **Design room shape** to open the manual editor. Drag room corners, add or remove corners to draw an outline, and click a wall to add a door or window. Set room dimensions, door width, hinge side, and swing direction; windows have editable width, sill height, and glass height. Roomfit renders windows as lightly tinted transparent glass and retains the wall above and below each opening.

`product-extractor.js` reads JSON-LD, product specifications, accordion text, and IKEA image candidates from the returned HTML. The optional LLM endpoint can help recover specifications not found by these parsers. To configure one, copy `.env.example` to `.env` and set:

- `ROOMFIT_LLM_URL` receives the extractor's `{ url, markdown, existing, schema }` request and must return the product object matching that schema. Dimensions must be in centimetres.

Set `ROOMFIT_LLM_TOKEN` if the provider requires a bearer token. Without an LLM endpoint the app still extracts JSON-LD, Open Graph data, and labeled dimensions from IKEA's returned HTML, using estimates for anything missing. Keep credentials only in `.env`, which is ignored by Git. Before exposing this server publicly, add authentication and rate limiting.

The browser module `product-extractor.js` checks Product JSON-LD, labeled dimensions in specification tables and definition lists, and the page's extracted text (including accordion content present in the fetched HTML) before asking the optional structured-output adapter for remaining gaps. It recognizes labeled width/depth/height values and dimension triples whose axis order is stated, and selects the first matching IKEA product-gallery image rather than preferring a PNG dimension diagram. The selected image is shown as a thumbnail in the furniture list and sampled for a dominant colour; when image sampling fails, the app keeps the metadata/URL/category colour fallback and reports a warning.


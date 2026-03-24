# RelFinder

RelFinder is a browser-based tool for discovering and visualising relationships between entities in RDF knowledge graphs. Point it at any public-facing SPARQL endpoint or upload a local RDF file, select two entities, and RelFinder finds and displays all connecting paths as an interactive force-directed graph.

It is a modernised, fully client-side (partial) rewrite of the original [RelFinder](https://github.com/VisualDataWeb/RelFinder) tool, rebuilt with current web technologies and requiring no server-side installation beyond an optional CORS proxy.

## Features

- **Flexible data sources** — connect to any SPARQL 1.1 endpoint (with optional HTTP Basic Auth and CORS proxy support) or upload a local RDF file (Turtle, N-Triples, N-Quads, TriG)
- **Entity autocomplete** — prefix search across multiple label predicates (`rdfs:label`, `skos:prefLabel`, `foaf:name`, `schema:name`) with support for custom label URIs
- **Class filtering** — constrain entity search to specific RDF types (e.g. `dbo:Person`, `schema:Movie`)
- **Language filtering** — target a specific language tag when retrieving labels
- **Configurable path search** — adjust maximum path length, exclude specific properties, and control cycle avoidance
- **Interactive force-directed graph** — springy D3-physics simulation via Cytoscape.js; drag nodes to explore, double-click to fix in place
- **Node detail panel** — inspect any node's IRI, RDF type, and data properties

## Usage

1. **Connect** — on the connection screen, either enter a SPARQL endpoint URL or drag-and-drop an RDF file.
2. **Search for entities** — in the graph view, type into the *Entity 1* and *Entity 2* fields. Autocomplete suggestions appear after a short delay.
3. **Optionally filter** — open *Query Options* to restrict by class, language, path length, or ignored properties.
4. **Find relationships** — click *Find Relationships*. The graph renders all discovered paths between the two entities.
5. **Explore** — drag nodes, click them for detail, zoom and pan, or re-run the layout with the toolbar buttons.

### Example endpoints

| Dataset | Endpoint URL |
|---------|-------------|
| DBpedia | `https://dbpedia.org/sparql` |
| Wikidata | `https://query.wikidata.org/sparql` |

Many public endpoints restrict browser access via CORS. Use the bundled CORS proxy (see below) if your endpoint does not send the required response headers.

## Development

Requires [Node.js](https://nodejs.org) `^20.19.0` or `>=22.12.0`.

```shell
# Install dependencies
npm install

# Start the development server (hot-reload)
# Open http://localhost:5173 in your browser
npm run dev

# Type-check, compile and minify for production
npm run build

# Preview the production build locally
npm run preview

# Format source code
npm run format

# Linting (oxlint + eslint)
npm run lint

# Type-check only
npm run type-check

# Run unit tests
npm run test:unit
```

The application is built with:

- [TypeScript](https://www.typescriptlang.org/) as the programming language
- [Vue 3](https://vuejs.org/) (Composition API) for the user interface
- [Vite](https://vitejs.dev/) as the build tool
- [PrimeVue 4](https://primevue.org/) (Aura theme) as the component library
- [Pinia](https://pinia.vuejs.org/) for state management
- [Cytoscape.js](https://cytoscape.org/) + [cytoscape-d3-force](https://github.com/shichuanpo/cytoscape.js-d3-force) for graph visualisation
- [Comunica](https://comunica.dev/) as the SPARQL query engine
- [N3.js](https://rdf.js.org/N3.js/) for local RDF parsing
- [ESLint](https://eslint.org/) + [Prettier](https://prettier.io/) for linting and formatting
- [Vitest](https://vitest.dev/) for unit testing

## CORS Proxy

Many SPARQL endpoints do not send `Access-Control-Allow-Origin` headers, which blocks browser requests. A lightweight Caddy-based proxy is included to work around this.

**Quick start with Docker Compose:**

```shell
# Copy and fill in the example environment file
cp .env.example .env   # set SPARQL_ENDPOINT=https://your-endpoint/sparql

# Start both the app and the proxy
docker compose up
```

The frontend will be available at `http://localhost:5173`.
The proxy will be available at `http://localhost:8080`.

In the RelFinder connection screen, set the **Proxy URL** field to `http://localhost:8080` to route queries through it.

## Bugs and Issues

Have a bug or feature request? [Open an issue](https://github.com/kodymoodley/relfinder/issues) on GitHub or contact the developers directly:

- Kody Moodley — kody.moodley@gmail.com
- Walter Simoncini — walter@ashita.nl

## License

RelFinder is available under a [dual license](LICENSE.md): open-source use is covered by [AGPL v3](https://www.gnu.org/licenses/agpl-3.0.txt); commercial or proprietary use requires a separate agreement — contact the developers above for details.

## AI Disclaimer

Portions of this codebase were developed with assistance from AI tools (GitHub Copilot, Claude). All AI-generated output has been reviewed for correctness and approved by the authors.

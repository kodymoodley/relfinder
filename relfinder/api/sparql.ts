import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ENDPOINTS = [
    'https://agrovoc.fao.org/sparql',
    'https://data.europa.eu/sparql',
    'https://publications.europa.eu/webapi/rdf/sparql',
    'https://data.ascdc.tw/sparql',
    'https://core.kmi.open.ac.uk/squery',
    'https://query.wikidata.org/sparql'
];

const ALLOWED_ORIGINS = [
    'https://kodymoodley.github.io',
    'https://relfinder.vercel.app',
    'http://localhost:5173',
    'http://localhost:4173'
];

function isAllowedOrigin(origin: string): boolean {
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    // Allow all Vercel preview deploy URLs for this project
    if (/^https:\/\/relfinder(-[a-z0-9]+)*\.vercel\.app$/.test(origin)) return true;
    return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const origin = (req.headers.origin as string) ?? '';
    const allowedOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const endpoint = req.query.endpoint as string | undefined;

    if (!endpoint || !ALLOWED_ENDPOINTS.includes(endpoint)) {
        return res.status(403).json({ error: 'Endpoint not allowed' });
    }

    let query: string;
    if (req.method === 'POST') {
        const body = req.body as Record<string, string> | undefined;
        query = body?.query ?? '';
        console.log('[sparql proxy] POST body query length:', query.length, 'endpoint:', endpoint);
    } else {
        query = (req.query.query as string) ?? '';
    }

    if (!query) {
        return res.status(400).json({ error: 'Missing query parameter' });
    }

    // Always use GET upstream — some endpoints (e.g. ASCDC) return HTML for POST.
    // Query sizes here are well within URL length limits.
    const targetUrl = `${endpoint}?query=${encodeURIComponent(query)}`;
    const response = await fetch(targetUrl, {
        headers: { Accept: 'application/sparql-results+json' },
    });

    const contentType = response.headers.get('content-type') ?? 'application/sparql-results+json';
    console.log('[sparql proxy] upstream response:', response.status, contentType, endpoint);

    if (!response.ok) {
        const body = await response.text();
        console.log('[sparql proxy] upstream error body (first 400):', body.slice(0, 400));
        return res.status(response.status).json({ error: `Upstream error: ${response.statusText}` });
    }

    if (contentType.includes('text/html')) {
        const body = await response.text();
        console.log('[sparql proxy] upstream returned HTML (first 400):', body.slice(0, 400));
        // Forward as-is so the client sees the content type and can diagnose
        res.setHeader('Content-Type', contentType);
        return res.status(200).send(body);
    }

    res.setHeader('Content-Type', contentType);
    res.status(200).send(await response.text());
}

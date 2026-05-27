import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ENDPOINTS = [
    'https://agrovoc.fao.org/sparql',
    'https://data.europa.eu/sparql',
    'https://publications.europa.eu/webapi/rdf/sparql',
    'https://data.ascdc.tw/sparql',
    'https://core.kmi.open.ac.uk/squery'
];

const ALLOWED_ORIGINS = [
    'https://kodymoodley.github.io',
    'https://relfinder.vercel.app',
    'http://localhost:5173',
    'http://localhost:4173',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const origin = (req.headers.origin as string) ?? '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { endpoint, query } = req.query as Record<string, string>;

    if (!ALLOWED_ENDPOINTS.includes(endpoint)) {
        return res.status(403).json({ error: 'Endpoint not allowed' });
    }

    const targetUrl = `${endpoint}?query=${encodeURIComponent(query)}`;
    const response = await fetch(targetUrl, {
        headers: { Accept: 'application/sparql-results+json' },
    });

    if (!response.ok) {
        return res.status(response.status).json({ error: `Upstream error: ${response.statusText}` });
    }

    const data = await response.json();
    res.status(200).json(data);
}
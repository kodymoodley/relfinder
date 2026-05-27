import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ENDPOINTS = [
    'https://dbpedia.org/sparql',
    'https://agrovoc.fao.org/sparql',
    'https://data.europa.eu/sparql',
    'https://publications.europa.eu/webapi/rdf/sparql',
    'https://data.ascdc.tw/sparql',
    'https://core.kmi.open.ac.uk/squery'
];

const ALLOWED_ORIGIN = 'https://kodymoodley.github.io';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { endpoint, query } = req.query as Record<string, string>;

    if (!ALLOWED_ENDPOINTS.includes(endpoint)) {
        return res.status(403).json({ error: 'Endpoint not allowed' });
    }

    const targetUrl = `${endpoint}?query=${encodeURIComponent(query)}&format=application%2Fsparql-results%2Bjson`;
    const response = await fetch(targetUrl, {
        headers: { Accept: 'application/sparql-results+json' },
    });

    const data = await response.json();
    res.status(200).json(data);
}
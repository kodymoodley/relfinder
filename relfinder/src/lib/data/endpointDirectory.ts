export interface EndpointEntry {
  id: string
  name: string
  url: string
  description: string
  domain: string
  /** Vercel proxy URL to use instead of hitting the endpoint directly (for CORS-restricted endpoints). */
  proxyUrl?: string
}

// On Vercel (production or any preview deploy) the proxy is same-origin — use a
// relative path so every deploy uses its own function without a CORS round-trip.
// On GitHub Pages and localhost the production proxy is called cross-origin.
const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
const VERCEL_PROXY = hostname.endsWith('.vercel.app')
  ? '/api/sparql'
  : 'https://relfinder.vercel.app/api/sparql'

export const ENDPOINT_DIRECTORY: EndpointEntry[] = [
  {
    id: 'dbpedia',
    name: 'DBpedia',
    url: 'https://dbpedia.org/sparql',
    description: 'Structured knowledge extracted from Wikipedia — people, places, organisations, and more.',
    domain: 'General Knowledge',
  },
  {
    id: 'lov',
    name: 'Linked Open Vocabularies',
    url: 'https://lov.linkeddata.es/dataset/lov/sparql',
    description: 'A curated catalogue of reusable vocabularies and ontologies published on the Web.',
    domain: 'Vocabularies & Ontologies',
  },
  {
    id: 'agrovoc',
    name: 'AGROVOC',
    url: 'https://agrovoc.fao.org/sparql',
    description: 'FAO\'s multilingual agricultural thesaurus covering food, nutrition, and natural resources.',
    domain: 'Agriculture',
    proxyUrl: VERCEL_PROXY,
  },
  {
    id: 'europa',
    name: 'EU Open Data',
    url: 'https://data.europa.eu/sparql',
    description: 'Open datasets published by European Union institutions and bodies.',
    domain: 'Government',
    proxyUrl: VERCEL_PROXY,
  },
  {
    id: 'publications-europa',
    name: 'EU Publications',
    url: 'https://publications.europa.eu/webapi/rdf/sparql',
    description: 'Controlled vocabularies and authority tables from the EU Publications Office.',
    domain: 'Government',
    proxyUrl: VERCEL_PROXY,
  },
  {
    id: 'ascdc',
    name: 'ASCDC',
    url: 'https://data.ascdc.tw/sparql',
    description: 'Cultural heritage and digital humanities datasets from Academia Sinica, Taiwan.',
    domain: 'Cultural Heritage',
    proxyUrl: VERCEL_PROXY,
  },
  {
    id: 'core',
    name: 'CORE',
    url: 'https://core.kmi.open.ac.uk/squery',
    description: 'Open access research papers and metadata aggregated by the Open University KMi.',
    domain: 'Research',
    proxyUrl: VERCEL_PROXY,
  },
]

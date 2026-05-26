export interface EndpointEntry {
  id: string
  name: string
  url: string
  description: string
  domain: string
}

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
]

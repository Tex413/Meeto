'use strict';

// Preliminary knockout screen of a brand name. It is not a trademark clearance search or legal advice.
// Usage: node scripts/trademark-screen.js <name> --stem <stem> --control <known mark> [domain ...]

const USPTO_URL = 'https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch';
const TIMEOUT_MS = 30000;
const PAGE_SIZE = 100;
const WORD_PATTERN = /^[a-z0-9]{3,40}$/i;
const DOMAIN_PATTERN = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
const FIELDS = ['wordmark', 'alive', 'internationalClass', 'ownerName', 'registrationId', 'statusDescription'];

function word(value, label) {
  if (typeof value !== 'string' || !WORD_PATTERN.test(value)) {
    throw new Error(`${label} must be 3 to 40 letters or digits`);
  }
  return value.toLowerCase();
}

// Throws on any incomplete answer: a failed search must never read as "no conflicts".
async function searchRegister(clauses, fetchImpl) {
  const response = await fetchImpl(USPTO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (trademark-screen)' },
    body: JSON.stringify({
      query: { bool: { must: clauses } }, size: PAGE_SIZE, track_total_hits: true, _source: FIELDS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`USPTO search failed with HTTP ${response.status}`);
  const body = await response.json();
  const hits = body.hits;
  if (!hits || !Array.isArray(hits.hits) || !Number.isInteger(hits.totalValue)) {
    throw new Error('USPTO answer holds no result set');
  }
  if (body.timedOut !== false || body.shardsFailed !== 0) throw new Error('USPTO search was incomplete');
  return {
    total: hits.totalValue,
    truncated: hits.totalValue > hits.hits.length,
    marks: hits.hits.map((hit) => ({ serial: hit.id, ...hit.source })),
  };
}

async function screenName(name, { stem, control, fetchImpl = fetch } = {}) {
  const wanted = word(name, 'name');
  const stemWord = word(stem, 'stem');
  const controlWord = word(control, 'control');
  const live = { term: { alive: true } };

  const known = await searchRegister([{ match_phrase: { wordmark: controlWord } }, live], fetchImpl);
  if (known.total === 0) {
    throw new Error(`Control mark "${controlWord}" returned nothing, so an empty result cannot be trusted`);
  }
  return {
    name: wanted,
    controlTotal: known.total,
    exact: await searchRegister([{ match_phrase: { wordmark: wanted } }], fetchImpl),
    similar: await searchRegister([{ match: { wordmark: { query: wanted, fuzziness: 2 } } }], fetchImpl),
    liveStem: await searchRegister([{ wildcard: { wordmark: `${stemWord}*` } }, live], fetchImpl),
  };
}

// The register misses unregistered products, so look at what the look-alike domains serve.
async function checkDomain(domain, { fetchImpl = fetch } = {}) {
  if (typeof domain !== 'string' || !DOMAIN_PATTERN.test(domain)) throw new Error(`Invalid domain: ${domain}`);
  try {
    const response = await fetchImpl(`https://${domain}/`, {
      headers: { 'user-agent': 'Mozilla/5.0 (trademark-screen)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await response.text();
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const description = /name=["']description["'][^>]*content="([^"]*)"/i.exec(html);
    return {
      domain,
      status: response.status,
      title: title ? title[1].replace(/\s+/g, ' ').trim() : '',
      description: description ? description[1].trim() : '',
    };
  } catch (error) {
    // An unreachable site is reported as unknown; it does not show that the name is unused.
    return { domain, status: null, error: (error.cause && error.cause.code) || error.message };
  }
}

async function main(argv) {
  const [name, ...rest] = argv;
  const options = {};
  const domains = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--stem' || rest[i] === '--control') options[rest[i].slice(2)] = rest[++i];
    else domains.push(rest[i]);
  }
  const register = await screenName(name, options);
  const sites = await Promise.all(domains.map((domain) => checkDomain(domain)));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), register, sites }, null, 2));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Screen failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { screenName, checkDomain };

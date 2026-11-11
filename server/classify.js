// Keyword rules that tag a headline with a category and a priority.
// Simple on purpose: edit the word lists to tune results.
// A trailing "=" on a keyword means "whole word only" (so "lac=" won't match "lack").

const words = (list) =>
  new RegExp(
    `\\b(${list.map((w) => (w.endsWith('=') ? `${w.slice(0, -1)}\\b` : w)).join('|')})`,
    'gi'
  );

// First match in this order wins ties, so put the most specific first.
const CATEGORY_RULES = [
  {
    name: 'Security and Conflicts',
    re: words([
      'attack', 'kill', 'blast', 'bomb', 'explosion', 'militant', 'terror', 'insurgen',
      'clash', 'gunmen', 'shooting', 'shot dead', 'ambush', 'rebel', 'ceasefire', 'hostage',
      'abduct', 'suicide', 'violence', 'encounter', 'raid', 'ttp=', 'baloch liberation', 'arakan army',
    ]),
  },
  {
    name: 'Military & Defense',
    re: words([
      'army', 'military', 'troops', 'soldier', 'defence', 'defense', 'missile', 'navy', 'naval',
      'air force', 'fighter jet', 'warship', 'drill', 'exercise', 'pla=', 'weapon', 'arms deal',
      'drone', 'submarine', 'commander', 'isi=', 'tatmadaw', 'junta',
    ]),
  },
  {
    name: 'Foreign Policy',
    re: words([
      'talks', 'bilateral', 'diplomat', 'ambassador', 'envoy', 'foreign minister', 'summit',
      'visit', 'ties=', 'relations', 'treaty', 'united nations', 'un=', 'sanction', 'accord',
      'delegation', 'condemn', 'mou=', 'memorandum', 'saarc', 'brics', 'sco=',
    ]),
  },
  {
    name: 'Economics and Trade',
    re: words([
      'economy', 'economic', 'trade', 'imf=', 'gdp=', 'inflation', 'export', 'import', 'investment',
      'budget', 'tariff', 'central bank', 'interest rate', 'rupee', 'taka=', 'yuan', 'afghani',
      'stock', 'market', 'debt', 'loan', 'bailout', 'remittance', 'revenue', 'tax=', 'taxes=',
    ]),
  },
  {
    name: 'Infrastructure',
    re: words([
      'port=', 'ports=', 'railway', 'rail=', 'road=', 'roads=', 'highway', 'dam=', 'dams=', 'hydropower',
      'airport', 'power plant', 'bridge', 'corridor', 'cpec', 'belt and road', 'bri=', 'pipeline',
      'tunnel', 'construction', 'grid=', 'metro',
    ]),
  },
];

const DEFAULT_CATEGORY = 'Internal Affairs';

const BREAKING = words([
  'breaking', 'killed', 'kills', 'killing', 'blast', 'explosion', 'attack', 'airstrike', 'air strike',
  'missile strike', 'earthquake', 'clash', 'firing', 'shelling', 'state of emergency', 'gunbattle',
]);

// Sport and entertainment are out of scope (and "attack", "strike" mislead the rules).
const OFF_TOPIC = words([
  'cricket', 'wicket', 'innings', 't20', 'odi=', 'test series', 'test match', 'batting', 'bowling',
  'bowler', 'batter', 'football', 'fifa', 'tournament', 'olympic', 'match report', 'squad', 'world cup',
  'asia cup', 'league', 'box office', 'bollywood', 'film', 'actor', 'actress', 'horoscope',
  'icc=', 'qualifier', 'u-17', 'u-19', 'u-23', 'players=', 'goals=', 'scores=', 'debut',
]);

// Cricket "Test" matches: capital T, next to a venue or cricket word.
const CRICKET_TEST =
  /\bTest (history|rankings?|ends|match|series|debut|squad|win|defeat|draw)\b|\b(Rawalpindi|Lahore|Karachi|Multan|Dhaka|Chattogram|Sylhet|Mirpur|Galle|Colombo|Harare|Bulawayo|Sri Lanka) Test\b/;

// Cricket scores like "404-4" or "all out for 210".
const SCORE = /\b\d{2,3}-\d{1,2}\b|\ball out\b|\bruns\b|\brun chase\b|\bcentury\b|\b\d(st|nd|rd|th) (test|odi|t20)\b|\bvs\.?\s|\bhighlights\b/i;

export const isOffTopic = (text) => count(OFF_TOPIC, text) > 0 || SCORE.test(text) || CRICKET_TEST.test(text);

// Which country a headline is really about. Searches for one country often
// return stories about a neighbour ("...in northwestern Pakistan" under Afghanistan).
const COUNTRY_TERMS = {
  Pakistan: words([
    'pakistan', 'islamabad', 'lahore', 'karachi', 'rawalpindi', 'khyber', 'balochistan', 'peshawar', 'sindh', 'punjab govt',
    'shehbaz', 'imran khan', 'asim munir', 'bilawal', 'zardari', 'maryam nawaz', 'nawaz sharif', 'pti=', 'pml-n', 'ispr',
  ]),
  China: words(['china', 'chinese', 'beijing', 'xi jinping', 'pla=', 'tibet', 'xinjiang', 'li qiang', 'wang yi', 'shanghai', 'hong kong']),
  Bangladesh: words(['bangladesh', 'dhaka', 'chittagong', 'chattogram', 'hasina', 'yunus', 'awami league', 'bnp=', 'jamaat', 'tarique']),
  Myanmar: words(['myanmar', 'burma', 'burmese', 'naypyidaw', 'yangon', 'mandalay', 'rakhine', 'tatmadaw', 'min aung hlaing', 'suu kyi', 'arakan army']),
  Nepal: words(['nepal', 'kathmandu', 'pokhara', 'prachanda', 'dahal', 'deuba', 'kp oli', 'sushila karki', 'balen']),
  Bhutan: words(['bhutan', 'thimphu', 'tobgay', 'wangchuck', 'gelephu']),
  Afghanistan: words(['afghan', 'kabul', 'taliban', 'kandahar', 'herat', 'akhundzada', 'muttaqi', 'zabihullah']),
};

// Local outlets also carry world news. A story that names another country and
// none of ours ("Iran hits out at US...") isn't about the outlet's country.
const FOREIGN = words([
  'iran', 'israel', 'gaza', 'palestin', 'lebanon', 'syria', 'iraq', 'yemen', 'saudi', 'qatar', 'uae=', 'turkey',
  'ukraine', 'russia', 'kremlin', 'putin', 'united states', 'u.s.', 'us=', 'washington', 'trump', 'white house',
  'europe', 'eu=', 'britain', 'uk=', 'france', 'germany', 'japan', 'korea', 'taiwan', 'philippines', 'indonesia',
  'thailand', 'vietnam', 'malaysia', 'australia', 'canada', 'mexico', 'brazil', 'venezuela', 'sudan', 'nigeria',
  'kenya', 'egypt', 'ethiopia',
]);

export const isForeignOnly = (text) => !detectCountry(text) && count(FOREIGN, text) > 0;

// The country a headline names most, or null if it names none of the seven.
export const detectCountry = (text) => resolveCountry(text, null);

export const resolveCountry = (text, fallback) => {
  if (fallback && count(COUNTRY_TERMS[fallback], text)) return fallback;
  let best = fallback;
  let bestScore = 0;
  for (const [country, re] of Object.entries(COUNTRY_TERMS)) {
    const score = count(re, text);
    if (score > bestScore) {
      best = country;
      bestScore = score;
    }
  }
  return best;
};

const HIGH = words([
  'india', 'border', 'lac=', 'loc=', 'line of control', 'line of actual control', 'kashmir',
  'ladakh', 'arunachal', 'doklam', 'sikkim', 'manipur', 'mizoram', 'military', 'army', 'troops',
  'missile', 'nuclear', 'terror', 'militant', 'sanction', 'election', 'protest', 'coup=', 'dead=',
]);

const count = (re, text) => (text.match(re) || []).length;

export const classifyCategory = (text) => {
  let best = DEFAULT_CATEGORY;
  let bestScore = 0;
  for (const rule of CATEGORY_RULES) {
    const score = count(rule.re, text);
    if (score > bestScore) {
      best = rule.name;
      bestScore = score;
    }
  }
  return best;
};

export const classifySeverity = (text) => {
  if (count(BREAKING, text)) return 'Breaking';
  if (count(HIGH, text)) return 'High Priority';
  return 'Routine';
};

// Tokens used to spot the same story reported by several outlets.
const STOP = new Set(
  'a an the of in on at to for and or but with from by as is are was were be after over amid says said new its his her their this that'.split(' ')
);

export const tokens = (title) =>
  new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );

export const similarity = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size);
};

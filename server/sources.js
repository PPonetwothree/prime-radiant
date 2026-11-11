// Who is behind each outlet, and which feeds we read directly.
//
// Types:
//   state         government-owned or -controlled (incl. state-funded foreign broadcasters)
//   exile         independent outlets operating from outside the country
//   local         domestic private/independent outlets
//   wire          international news agencies
//   indian        Indian outlets (a distinct national perspective for this dashboard)
//   international foreign/regional outlets
//
// Labels are a reading aid, not a verdict on accuracy. Edit freely.

export const TYPE_LABELS = {
  state: 'State media',
  exile: 'Exile media',
  local: 'Local',
  wire: 'Wire',
  indian: 'Indian',
  international: 'International',
};

// [pattern matched against the outlet name, type, note]
const REGISTRY = [
  // China
  [/xinhua/i, 'state', 'Chinese state news agency'],
  [/people.?s daily/i, 'state', 'Chinese Communist Party newspaper'],
  [/global times/i, 'state', "Chinese state-owned (People's Daily group)"],
  [/china daily/i, 'state', 'Chinese state-owned'],
  [/\bcgtn\b|\bcctv\b|china central television/i, 'state', 'Chinese state broadcaster'],
  [/sixth tone/i, 'state', 'Owned by state-run Shanghai United Media Group'],
  [/south china morning post|\bscmp\b/i, 'international', 'Hong Kong, owned by Alibaba'],
  // Myanmar
  [/myanmar international tv|\bmitv\b|\bmrtv\b|myanma radio/i, 'state', 'Myanmar state broadcaster, under military control'],
  [/global new light of myanmar|\bgnlm\b|myanma alinn|mirror daily/i, 'state', 'Myanmar state newspaper, under military control'],
  [/irrawaddy/i, 'exile', 'Independent, operates from exile'],
  [/myanmar now/i, 'exile', 'Independent, operates from exile'],
  [/\bdvb\b|democratic voice of burma/i, 'exile', 'Independent, operates from exile'],
  [/mizzima/i, 'exile', 'Independent, operates from exile'],
  [/frontier myanmar/i, 'local', 'Independent, Yangon-based'],
  [/နိုင်ငံခြားရေး|ministry of foreign affairs.*myanmar/i, 'state', 'Myanmar foreign ministry (military government)'],
  [/shan herald|karen news|kantarawaddy|narinjara|kachin news|chinland|myitkyina news/i, 'local', 'Ethnic-region independent media'],
  // Bangladesh
  [/bangladesh sangbad sangstha|\bbss\b/i, 'state', 'Bangladesh state news agency'],
  [/\bbtv\b|bangladesh television/i, 'state', 'Bangladesh state broadcaster'],
  [/daily star|dhaka tribune|prothom alo|^the business standard$|\btbs\b|tbsnews|bdnews24|new age|financial express.*bd|daily sun|united news of bangladesh|banglanews24|jugantor|kaler kantho|new nation|daily observer/i, 'local', null],
  // Pakistan
  [/associated press of pakistan|\bapp\b/i, 'state', 'Pakistan state news agency'],
  [/\bptv\b|pakistan television|radio pakistan/i, 'state', 'Pakistan state broadcaster'],
  [/\bdawn\b|express tribune|geo news|\bgeo\b|the news international|business recorder|ary news|pakistan today|daily times|the nation/i, 'local', null],
  // Nepal
  [/rising nepal|gorkhapatra|rastriya samachar|\brss\b nepal|nepal television/i, 'state', 'Nepal state-owned'],
  [/kathmandu post|himalayan times|republica|onlinekhabar|khabarhub|ratopati|setopati|nepalnews|annapurna|nepali times|kantipur/i, 'local', null],
  // Bhutan
  [/\bbbs\b|bhutan broadcasting/i, 'state', 'Bhutan state-owned broadcaster'],
  [/kuensel/i, 'state', 'Bhutan, majority government-owned'],
  [/the bhutanese|business bhutan|bhutan live/i, 'local', null],
  // Afghanistan
  [/bakhtar/i, 'state', 'Afghan state news agency, under Taliban control'],
  [/radio television afghanistan|\brta\b|al.?emarah/i, 'state', 'Under Taliban control'],
  [/amu\b|amu tv/i, 'exile', 'Independent, operates from exile'],
  [/afghanistan international/i, 'exile', 'Operates from exile (London)'],
  [/kabul ?now/i, 'exile', 'Independent, operates from exile'],
  [/8am|hasht.?e.?subh/i, 'exile', 'Independent, operates from exile'],
  [/zan times|rukhshana/i, 'exile', 'Independent, operates from exile'],
  [/tolo|pajhwok|khaama|ariana|shamshad|kabul ?tribune/i, 'local', 'Domestic outlet working under Taliban media rules'],
  // Other state-funded
  [/\btass\b|sputnik|\brt\b|russia today/i, 'state', 'Russian state media'],
  [/anadolu/i, 'state', 'Turkish state news agency'],
  [/press tv|\birna\b/i, 'state', 'Iranian state media'],
  [/voice of america|\bvoa\b|radio free asia|\brfa\b|radio free europe/i, 'state', 'US government-funded'],
  [/dd news|doordarshan|all india radio|news on air|prasar bharati|\bpib\b/i, 'state', 'Indian public broadcaster / government'],
  // Wires
  [/reuters/i, 'wire', null],
  [/associated press|ap news|\bap\b/i, 'wire', null],
  [/\bafp\b|agence france/i, 'wire', null],
  [/bloomberg/i, 'wire', null],
  // Indian
  [/times of india|hindustan times|ndtv|india today|the hindu|indian express|economic times|news18|firstpost|theprint|wion|zee news|abp|republic|deccan|tribune india|the tribune|business standard|livemint|\bmint\b|outlook|\bani\b|\bpti\b|press trust of india|organiser|swarajya|opindia|the statesman|telegraph india|free press journal|the wire|scroll|moneycontrol|news9|india\.com|eurasian times|orissapost|pioneer|bhaskar|rediff|news on air|lokmat|devdiscourse|tv9/i, 'indian', null],
  // International
  [/\bbbc\b|al jazeera|\bdw\b|deutsche welle|the diplomat|\bcnn\b|guardian|new york times|washington post|nikkei|the economist|financial times|foreign policy|\bnpr\b|france 24|abc news|\bcbc\b|straits times|bangkok post|japan times|arab news|asia times|cnbc|the independent|asia news network|reliefweb|united nations|\bundp\b|unicef|\bunhcr\b|human rights watch|amnesty/i, 'international', null],
];

// Sports and entertainment outlets: skipped entirely.
export const SKIP_SOURCES = /cricbuzz|cricinfo|kayo sports|sportstar|espn|sportskeeda|crictracker|wisden|goal\.com|bollywood|pinkvilla|filmfare/i;

export const sourceInfo = (name = '') => {
  for (const [re, type, note] of REGISTRY) {
    if (re.test(name)) return { type, label: TYPE_LABELS[type], note };
  }
  return { type: null, label: null, note: null };
};

// Feeds read directly (checked working on 2026-11-11). `country: null` means a
// regional outlet: only items that name one of the seven countries are kept.
export const FEEDS = [
  // Pakistan
  { id: 'dawn', name: 'Dawn', country: 'Pakistan', url: 'https://www.dawn.com/feeds/home' },
  { id: 'tribune-pk', name: 'The Express Tribune', country: 'Pakistan', url: 'https://tribune.com.pk/feed/home' },
  { id: 'geo', name: 'Geo News', country: 'Pakistan', url: 'https://www.geo.tv/rss/1/1' },
  { id: 'brecorder', name: 'Business Recorder', country: 'Pakistan', url: 'https://www.brecorder.com/feeds/latest-news' },
  { id: 'app', name: 'Associated Press of Pakistan', country: 'Pakistan', url: 'https://www.app.com.pk/feed/' },
  // China
  { id: 'scmp-china', name: 'South China Morning Post', country: 'China', url: 'https://www.scmp.com/rss/4/feed/' },
  { id: 'cgtn', name: 'CGTN', country: 'China', url: 'https://www.cgtn.com/subscribe/rss/section/china.xml' },
  { id: 'sixthtone', name: 'Sixth Tone', country: 'China', url: 'https://www.sixthtone.com/rss' },
  // Bangladesh
  { id: 'dhakatribune', name: 'Dhaka Tribune', country: 'Bangladesh', url: 'https://www.dhakatribune.com/feed/' },
  { id: 'prothomalo', name: 'Prothom Alo', country: 'Bangladesh', url: 'https://en.prothomalo.com/feed/' },
  { id: 'tbs', name: 'The Business Standard', country: 'Bangladesh', url: 'https://www.tbsnews.net/top-news/rss.xml' },
  { id: 'dailystar-bd', name: 'The Daily Star', country: 'Bangladesh', url: 'https://www.thedailystar.net/news/bangladesh/rss.xml' },
  { id: 'dailystar-pol', name: 'The Daily Star', country: 'Bangladesh', url: 'https://www.thedailystar.net/news/bangladesh/politics/rss.xml' },
  // Myanmar
  { id: 'irrawaddy', name: 'The Irrawaddy', country: 'Myanmar', url: 'https://www.irrawaddy.com/feed' },
  { id: 'myanmarnow', name: 'Myanmar Now', country: 'Myanmar', url: 'https://myanmar-now.org/en/feed/' },
  { id: 'dvb', name: 'DVB', country: 'Myanmar', url: 'https://english.dvb.no/feed/' },
  { id: 'gnlm', name: 'Global New Light of Myanmar', country: 'Myanmar', url: 'https://www.gnlm.com.mm/feed/' },
  // Nepal
  { id: 'kathmandupost', name: 'The Kathmandu Post', country: 'Nepal', url: 'https://kathmandupost.com/rss' },
  { id: 'himalayantimes', name: 'The Himalayan Times', country: 'Nepal', url: 'https://thehimalayantimes.com/rssFeed/15' },
  { id: 'risingnepal', name: 'The Rising Nepal', country: 'Nepal', url: 'https://risingnepaldaily.com/rss' },
  { id: 'onlinekhabar', name: 'Onlinekhabar', country: 'Nepal', url: 'https://english.onlinekhabar.com/feed' },
  { id: 'khabarhub', name: 'Khabarhub', country: 'Nepal', url: 'https://english.khabarhub.com/feed/' },
  // Bhutan
  { id: 'thebhutanese', name: 'The Bhutanese', country: 'Bhutan', url: 'https://thebhutanese.bt/feed/' },
  { id: 'businessbhutan', name: 'Business Bhutan', country: 'Bhutan', url: 'https://businessbhutan.bt/feed/' },
  { id: 'bbs', name: 'BBS', country: 'Bhutan', url: 'https://www.bbs.bt/feed/' },
  // Afghanistan
  { id: 'amu', name: 'Amu TV', country: 'Afghanistan', url: 'https://amu.tv/feed/' },
  { id: 'khaama', name: 'Khaama Press', country: 'Afghanistan', url: 'https://www.khaama.com/feed/' },
  { id: 'ariana', name: 'Ariana News', country: 'Afghanistan', url: 'https://www.ariananews.af/feed/' },
  { id: 'kabulnow', name: 'KabulNow', country: 'Afghanistan', url: 'https://kabulnow.com/feed/' },
  { id: '8am', name: '8am Media', country: 'Afghanistan', url: 'https://8am.media/eng/feed/' },
  // Regional / international (country inferred from the headline)
  { id: 'diplomat', name: 'The Diplomat', country: null, url: 'https://thediplomat.com/feed/' },
  { id: 'aljazeera', name: 'Al Jazeera', country: null, url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'bbc-asia', name: 'BBC News', country: null, url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml' },
  { id: 'dw-asia', name: 'DW', country: null, url: 'https://rss.dw.com/rdf/rss-en-asia' },
];

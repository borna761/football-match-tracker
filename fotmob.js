// FotMob URL resolution — x-mas token auth + /api/data/matches endpoint

// ── MD5 (pure JS, RFC 1321) ──────────────────────────────────────────────────
function _md5hex(str) {
  function safe(x, y) {
    const l = (x & 0xffff) + (y & 0xffff);
    return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff);
  }
  function lr(x, n) { return (x << n) | (x >>> (32 - n)); }
  function ff(a,b,c,d,m,s,t){return safe(lr(safe(safe(a,(b&c)|(~b&d)),safe(m,t)),s),b);}
  function gg(a,b,c,d,m,s,t){return safe(lr(safe(safe(a,(b&d)|(c&~d)),safe(m,t)),s),b);}
  function hh(a,b,c,d,m,s,t){return safe(lr(safe(safe(a,b^c^d),safe(m,t)),s),b);}
  function ii(a,b,c,d,m,s,t){return safe(lr(safe(safe(a,c^(b|~d)),safe(m,t)),s),b);}

  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const nb = Math.ceil((len + 9) / 64);
  const M = new Array(nb * 16).fill(0);
  for (let i = 0; i < len; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
  M[len >> 2] |= 0x80 << ((len % 4) * 8);
  M[nb * 16 - 2] = len * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < M.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d], k = M.slice(i, i + 16);
    a=ff(a,b,c,d,k[0],7,-680876936);  d=ff(d,a,b,c,k[1],12,-389564586);
    c=ff(c,d,a,b,k[2],17,606105819);  b=ff(b,c,d,a,k[3],22,-1044525330);
    a=ff(a,b,c,d,k[4],7,-176418897);  d=ff(d,a,b,c,k[5],12,1200080426);
    c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
    a=ff(a,b,c,d,k[8],7,1770035416);  d=ff(d,a,b,c,k[9],12,-1958414417);
    c=ff(c,d,a,b,k[10],17,-42063);    b=ff(b,c,d,a,k[11],22,-1990404162);
    a=ff(a,b,c,d,k[12],7,1804603682); d=ff(d,a,b,c,k[13],12,-40341101);
    c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
    a=gg(a,b,c,d,k[1],5,-165796510);  d=gg(d,a,b,c,k[6],9,-1069501632);
    c=gg(c,d,a,b,k[11],14,643717713); b=gg(b,c,d,a,k[0],20,-373897302);
    a=gg(a,b,c,d,k[5],5,-701558691);  d=gg(d,a,b,c,k[10],9,38016083);
    c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
    a=gg(a,b,c,d,k[9],5,568446438);   d=gg(d,a,b,c,k[14],9,-1019803690);
    c=gg(c,d,a,b,k[3],14,-187363961); b=gg(b,c,d,a,k[8],20,1163531501);
    a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);
    c=gg(c,d,a,b,k[7],14,1735328473); b=gg(b,c,d,a,k[12],20,-1926607734);
    a=hh(a,b,c,d,k[5],4,-378558);     d=hh(d,a,b,c,k[8],11,-2022574463);
    c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
    a=hh(a,b,c,d,k[1],4,-1530992060); d=hh(d,a,b,c,k[4],11,1272893353);
    c=hh(c,d,a,b,k[7],16,-155497632); b=hh(b,c,d,a,k[10],23,-1094730640);
    a=hh(a,b,c,d,k[13],4,681279174);  d=hh(d,a,b,c,k[0],11,-358537222);
    c=hh(c,d,a,b,k[3],16,-722521979); b=hh(b,c,d,a,k[6],23,76029189);
    a=hh(a,b,c,d,k[9],4,-640364487);  d=hh(d,a,b,c,k[12],11,-421815835);
    c=hh(c,d,a,b,k[15],16,530742520); b=hh(b,c,d,a,k[2],23,-995338651);
    a=ii(a,b,c,d,k[0],6,-198630844);  d=ii(d,a,b,c,k[7],10,1126891415);
    c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
    a=ii(a,b,c,d,k[12],6,1700485571); d=ii(d,a,b,c,k[3],10,-1894986606);
    c=ii(c,d,a,b,k[10],15,-1051523);  b=ii(b,c,d,a,k[1],21,-2054922799);
    a=ii(a,b,c,d,k[8],6,1873313359);  d=ii(d,a,b,c,k[15],10,-30611744);
    c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
    a=ii(a,b,c,d,k[4],6,-145523070);  d=ii(d,a,b,c,k[11],10,-1120210379);
    c=ii(c,d,a,b,k[2],15,718787259);  b=ii(b,c,d,a,k[9],21,-343485551);
    a=safe(a,oa); b=safe(b,ob); c=safe(c,oc); d=safe(d,od);
  }
  function hex(n) {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((n >> (i*8+4)) & 15).toString(16) + ((n >> (i*8)) & 15).toString(16);
    return s;
  }
  return [a, b, c, d].map(hex).join("");
}

// ── x-mas token (extracted from FotMob's own JS bundle) ─────────────────────
const _FM_FOO = "production:890a7b4a1c175737a2bbeb7a8efc1fadcc9ddbdd";
const _FM_KEY = "[Spoken Intro: Alan Hansen & Trevor Brooking]\nI think it's bad news for the English game\nWe're not creative enough, and we're not positive enough\n\n[Refrain: Ian Broudie & Jimmy Hill]\nIt's coming home, it's coming home, it's coming\nFootball's coming home (We'll go on getting bad results)\nIt's coming home, it's coming home, it's coming\nFootball's coming home\nIt's coming home, it's coming home, it's coming\nFootball's coming home\nIt's coming home, it's coming home, it's coming\nFootball's coming home\n\n[Verse 1: Frank Skinner]\nEveryone seems to know the score, they've seen it all before\nThey just know, they're so sure\nThat England's gonna throw it away, gonna blow it away\nBut I know they can play, 'cause I remember\n\n[Chorus: All]\nThree lions on a shirt\nJules Rimet still gleaming\nThirty years of hurt\nNever stopped me dreaming\n\n[Verse 2: David Baddiel]\nSo many jokes, so many sneers\nBut all those \"Oh, so near\"s wear you down through the years\nBut I still see that tackle by Moore and when Lineker scored\nBobby belting the ball, and Nobby dancing\n\n[Chorus: All]\nThree lions on a shirt\nJules Rimet still gleaming\nThirty years of hurt\nNever stopped me dreaming\n\n[Bridge]\nEngland have done it, in the last minute of extra time!\nWhat a save, Gordon Banks!\nGood old England, England that couldn't play football!\nEngland have got it in the bag!\nI know that was then, but it could be again\n\n[Refrain: Ian Broudie]\nIt's coming home, it's coming\nFootball's coming home\nIt's coming home, it's coming home, it's coming\nFootball's coming home\n(England have done it!)\nIt's coming home, it's coming home, it's coming\nFootball's coming home\nIt's coming home, it's coming home, it's coming\nFootball's coming home\n[Chorus: All]\n(It's coming home) Three lions on a shirt\n(It's coming home, it's coming) Jules Rimet still gleaming\n(Football's coming home\nIt's coming home) Thirty years of hurt\n(It's coming home, it's coming) Never stopped me dreaming\n(Football's coming home\nIt's coming home) Three lions on a shirt\n(It's coming home, it's coming) Jules Rimet still gleaming\n(Football's coming home\nIt's coming home) Thirty years of hurt\n(It's coming home, it's coming) Never stopped me dreaming\n(Football's coming home\nIt's coming home) Three lions on a shirt\n(It's coming home, it's coming) Jules Rimet still gleaming\n(Football's coming home\nIt's coming home) Thirty years of hurt\n(It's coming home, it's coming) Never stopped me dreaming\n(Football's coming home)";

function _fotmobToken(apiPath) {
  const body = { url: apiPath, code: Date.now(), foo: _FM_FOO };
  const sig = _md5hex(JSON.stringify(body) + _FM_KEY).toUpperCase();
  return btoa(JSON.stringify({ body, signature: sig }));
}

// ── Team name normalisation ───────────────────────────────────────────────────
function normalizeTeam(name) {
  return name
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|ac|bsc|fk|rb)\b\.?\s*/g, "")
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

// ── Fetch FotMob match URLs ───────────────────────────────────────────────────
async function fetchFotmobUrls(dates) {
  const map = {};
  await Promise.allSettled(dates.slice(0, 5).map(async (dateStr) => {
    const path = `/api/data/matches?date=${dateStr.replace(/-/g, "")}&timezone=UTC`;
    const res = await fetch("https://www.fotmob.com" + path, {
      headers: {
        "x-mas": _fotmobToken(path),
        "Referer": "https://www.fotmob.com/",
        "Accept": "application/json",
      },
    });
    if (!res.ok) return;
    const data = await res.json();
    for (const league of (data.leagues || [])) {
      for (const match of (league.matches || [])) {
        const hName = match.home?.name;
        const aName = match.away?.name;
        if (!hName || !aName || !match.id) continue;
        const key = `${normalizeTeam(hName)}|${normalizeTeam(aName)}`;
        map[key] = `https://www.fotmob.com/match/${match.id}`;
      }
    }
  }));
  return map;
}

function getFotmobUrl(match, fotmobMap) {
  const hN = normalizeTeam(match.homeTeam.name);
  const aN = normalizeTeam(match.awayTeam.name);
  const direct = fotmobMap[`${hN}|${aN}`];
  if (direct) return direct;
  // Substring fallback for names like "FC Internazionale Milano" → "inter"
  for (const [key, url] of Object.entries(fotmobMap)) {
    const [fmH, fmA] = key.split("|");
    if ((hN.includes(fmH) || fmH.includes(hN)) && (aN.includes(fmA) || fmA.includes(aN))) {
      return url;
    }
  }
  const home = match.homeTeam.shortName || match.homeTeam.name;
  const away = match.awayTeam.shortName || match.awayTeam.name;
  return `https://www.fotmob.com/search?q=${encodeURIComponent(`${home} ${away}`)}`;
}

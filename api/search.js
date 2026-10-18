const hits = new Map(), bad = new Map();
const MAX_PER_SEARCH = 50;
const recent = (m, ip) => {
  const now = Date.now(), a = (m.get(ip) || []).filter(t => now - t < 3600e3);
  if (m.size > 5000) m.clear();
  m.set(ip, a); return a;
};

module.exports = async (req, res) => {
  const key = process.env.TOMTOM_KEY;
  const codes = new Set(String(process.env.ACCESS_CODES || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
  if (!key || !codes.size) return res.status(500).json({ error: 'config' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const h = recent(hits, ip), bd = recent(bad, ip);
  if (h.length >= (+process.env.HOURLY_LIMIT || 60) || bd.length >= 10) return res.status(429).json({ error: 'rate' });
  h.push(Date.now());

  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const code = String(b.code || '').trim().toLowerCase();
  if (!codes.has(code)) { bd.push(Date.now()); return res.status(401).json({ error: 'code' }); }
  if (b.check) return res.status(200).json({ ok: true });

  const q = String(b.q || '').trim().slice(0, 100);
  if (!q) return res.status(400).json({ error: 'q' });
  const need = Math.min(Math.max(parseInt(b.count) || 20, 1), MAX_PER_SEARCH);
  const seen = new Set(Array.isArray(b.seen) ? b.seen.slice(0, 500).map(String) : []);
  const items = [];
  try {
    let ofs = 0;
    for (let i = 0; i < 5 && items.length < need; i++) {
      const r = await fetch('https://api.tomtom.com/search/2/search/' + encodeURIComponent(q) +
        '.json?key=' + encodeURIComponent(key) + '&limit=100&ofs=' + ofs + '&language=ru-RU&idxSet=POI');
      if (!r.ok) return res.status(502).json({ error: 'upstream', status: r.status });
      const all = (await r.json()).results || [];
      for (const x of all) {
        if (!x.poi || !x.poi.name || seen.has(x.id)) continue;
        if (b.noSite && x.poi.url) continue;
        seen.add(x.id);
        items.push({ tid: x.id, name: x.poi.name, phone: x.poi.phone || '', site: !!x.poi.url,
          addr: (x.address && x.address.freeformAddress) || '', ll: x.position ? [x.position.lat, x.position.lon] : null });
        if (items.length >= need) break;
      }
      if (all.length < 100) break;
      ofs += all.length;
    }
  } catch (e) { return res.status(502).json({ error: 'fetch' }); }
  res.status(200).json({ items });
};

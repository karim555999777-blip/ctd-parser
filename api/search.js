// Vercel serverless function: проксирует поиск в TomTom, ключ хранится только на сервере.
const hits = new Map();

module.exports = async (req, res) => {
  const key = process.env.TOMTOM_KEY;
  if (!key) return res.status(500).json({ error: 'no_key' });

  // Мягкий лимит на пользователя (по IP), чтобы один человек не съел всю квоту
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now(), MAX = +process.env.HOURLY_LIMIT || 40;
  const h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (h.length >= MAX) return res.status(429).json({ error: 'rate' });
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();

  const q = String(req.query.q || '').trim().slice(0, 100);
  const ofs = Math.min(Math.max(parseInt(req.query.ofs) || 0, 0), 500);
  if (!q) return res.status(400).json({ error: 'q' });

  const url = 'https://api.tomtom.com/search/2/search/' + encodeURIComponent(q) +
    '.json?key=' + encodeURIComponent(key) + '&limit=100&ofs=' + ofs + '&language=ru-RU&idxSet=POI';
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: 'upstream', status: r.status });
    const d = await r.json();
    const all = d.results || [];
    const items = all.filter(x => x.poi && x.poi.name).map(x => ({
      tid: x.id,
      name: x.poi.name,
      phone: x.poi.phone || '',
      site: !!x.poi.url,
      addr: (x.address && x.address.freeformAddress) || '',
      ll: x.position ? [x.position.lat, x.position.lon] : null
    }));
    res.setHeader('Cache-Control', 's-maxage=600');
    res.status(200).json({ items, next: all.length < 100 ? null : ofs + all.length });
  } catch (e) {
    res.status(502).json({ error: 'fetch' });
  }
};

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (body.action === 'feedback') return handleFeedback(body);
  if (body.action === 'search') return handleSearch(body.city);
  if (body.action === 'trip') return handleTrip(body);
  if (body.action === 'filter') return handleFilter(body);

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};

async function handleFilter(body) {
  const { category, lat, lng, cityHint } = body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };

  const locationDesc = cityHint || (lat && lng ? `coordinates ${lat}, ${lng}` : null);
  if (!locationDesc) return { statusCode: 400, body: JSON.stringify({ error: 'Location required' }) };

  const prompts = {
    free: `I need free overnight spots near ${locationDesc} for someone living out of their vehicle. Cover: Walmart locations that allow overnight parking (with addresses if possible), casino parking lots, rest areas on nearby highways, any known free public parking. Be specific with names and locations. Bullet points, under 250 words, no fluff.`,
    parking: `I need parking lot overnight options near ${locationDesc} for a vehicle dweller. Cover: Walmart, Sam's Club, Cracker Barrel, casino parking, truck stops, any large retail lots known to allow overnight stays. Specific locations and any known restrictions. Bullet points, under 250 words.`,
    public: `I need free public land camping options near ${locationDesc} for someone living in their vehicle. Cover: BLM land, National Forest dispersed camping, state forest, wildlife management areas, any public land where overnight vehicle camping is legal. How far away, how to access, any restrictions. Bullet points, under 250 words.`,
    paid: `I need the cheapest paid overnight options near ${locationDesc} for a vehicle dweller on a tight budget. Cover: budget motel chains with ballpark pricing, KOA or campgrounds, weekly rate motels, extended stay options. Specific names and price ranges. Bullet points, under 250 words.`,
    shower: `I need shower facilities near ${locationDesc} for someone living out of their vehicle. Cover: truck stops with shower rooms (Pilot, Flying J, Love's, TA/Petro — name specific locations), Planet Fitness or gym locations, campground shower facilities, any YMCA. Include cost and hours. This is hygiene-critical — be specific. Bullet points, under 250 words.`,
  };

  const prompt = prompts[category];
  if (!prompt) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown category' }) };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: 'You are a practical road-life advisor for vehicle dwellers and budget travelers. Give hyper-specific, honest, actionable local intel. Name real businesses and locations. Never be vague. If you genuinely don\'t know specific local details for this area, say so clearly. No fluff, no preamble, just the information.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Upstream API error' }) };
    const result = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result }) };
  } catch (err) {
    console.error('Filter error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleFeedback(body) {
  const { card_id, card_title, type, message, location } = body;
  if (!card_id || !type) return { statusCode: 400, body: JSON.stringify({ error: 'card_id and type required' }) };
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ card_id, card_title, type, message: message || null, location: location || null })
    });
    if (!resp.ok) { const err = await resp.text(); console.error('Supabase error:', err); return { statusCode: 502, body: JSON.stringify({ error: 'Database error' }) }; }
    if (type === 'safety') console.error(`SAFETY FLAG: card=${card_id} location=${location} message=${message}`);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Feedback error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
}

async function handleSearch(city) {
  if (!city) return { statusCode: 400, body: JSON.stringify({ error: 'city is required' }) };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are a practical road-life advisor for vehicle dwellers, homeless travelers, and people living out of their cars. You speak plainly and with respect — no condescension, no judgment. Give hyper-specific, honest, actionable local intel. Include hygiene and safety notes for women and people with long hair where relevant. Never be vague. Format as clean bullet points. No fluff. Under 300 words.',
        messages: [{ role: 'user', content: `I'm living out of my vehicle and need the cheapest overnight options near ${city}. Cover: Walmart locations that allow overnight parking, nearby BLM or National Forest land, rest areas on nearby interstates, truck stops with showers (name them), Planet Fitness or gym locations for daily showers, budget motels with ballpark pricing, and any local quirks or restrictions. Note safety concerns for solo travelers, especially women.` }]
      })
    });
    const data = await response.json();
    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Upstream API error' }) };
    const result = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result }) };
  } catch (err) {
    console.error('Search error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleTrip(body) {
  const { origin, destination, milesPerDay } = body;
  if (!origin || !destination) return { statusCode: 400, body: JSON.stringify({ error: 'origin and destination required' }) };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  const mpd = milesPerDay || 300;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are a practical road-life advisor for vehicle dwellers, homeless travelers, and people living out of their cars. You speak with respect and zero judgment. Your job is to give them the most useful trip planning information possible so they feel prepared and safe.

You MUST respond with valid JSON only. No markdown, no preamble, no explanation outside the JSON. The JSON must match this exact structure:

{
  "totalMiles": number,
  "totalDays": number,
  "days": [
    {
      "day": number,
      "drive": "City A to City B",
      "miles": number,
      "stopCity": "City, State",
      "sleepOptions": [
        {
          "type": "free|cheap|paid",
          "name": "Name of place",
          "detail": "Specific actionable detail"
        }
      ],
      "showerStop": {
        "name": "Name of shower facility",
        "detail": "Specific detail — chain name, location area, cost"
      },
      "safetyNote": "One honest safety note for this stop",
      "womenNote": "One specific note for women travelers at this stop",
      "highlight": "The single most important thing to know about this day's stop"
    }
  ],
  "packingNotes": ["tip1", "tip2", "tip3"],
  "showerPlan": "A plain-English paragraph describing the shower strategy for the whole trip"
}`,
        messages: [{ role: 'user', content: `Plan a road trip from ${origin} to ${destination} driving approximately ${mpd} miles per day. I am living out of my vehicle on a tight budget. For each overnight stop give me the best free or cheap sleep options, the nearest shower facility, a safety note, and a note specifically for women traveling alone. Be specific with place names. Give me real intel, not generic advice.` }]
      })
    });
    const data = await response.json();
    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Upstream API error' }) };
    const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    let tripData;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      tripData = JSON.parse(clean);
    } catch(e) {
      console.error('JSON parse error:', e);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not parse trip plan' }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trip: tripData }) };
  } catch (err) {
    console.error('Trip error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

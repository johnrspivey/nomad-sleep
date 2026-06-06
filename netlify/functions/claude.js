exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let city;
  try {
    ({ city } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!city) {
    return { statusCode: 400, body: JSON.stringify({ error: 'city is required' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are a practical road-life advisor for vehicle dwellers and budget travelers. Give hyper-specific, honest, actionable local intel. Include hygiene and safety notes for women and people with long hair where relevant. Never be vague — if you don\'t know specific local details, say so clearly rather than guessing. Format as clean bullet points. No fluff. Keep under 300 words.',
        messages: [{
          role: 'user',
          content: `I'm living out of my vehicle and need the cheapest overnight options near ${city}. Cover: Walmart locations that allow overnight parking, nearby BLM or National Forest land, rest areas on nearby interstates, truck stops with showers (name them), Planet Fitness or gym locations for daily showers, budget motels with ballpark pricing, and any local quirks or restrictions I should know. Note any safety concerns for solo travelers, especially women.`
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Upstream API error', detail: data?.error?.message })
      };
    }

    const result = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result })
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

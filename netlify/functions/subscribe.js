// Netlify Function: /.netlify/functions/subscribe
// Proxies form submissions to MailerLite (double opt-in flow).
// API key + group ID read from Netlify env vars (never exposed client-side).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://forestparkpicnics.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.MAILERLITE_API_KEY;
  const groupId = process.env.MAILERLITE_GROUP_ID;
  if (!apiKey || !groupId) {
    console.error('Missing MAILERLITE_API_KEY or MAILERLITE_GROUP_ID env var.');
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Subscription temporarily unavailable' }),
    };
  }

  let email, source;
  try {
    ({ email, source } = JSON.parse(event.body || '{}'));
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request body' }),
    };
  }

  // Basic email shape validation — defense in depth, real check is HTML5 + MailerLite
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Please enter a valid email address' }),
    };
  }

  try {
    // status: 'unconfirmed' so MailerLite treats this as requiring confirmation.
    // Custom field `source` lets us track which form it came from (footer vs popup).
    const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        email,
        groups: [groupId],
        status: 'unconfirmed',
        fields: source ? { source } : undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));

    // 200/201 = created or already present (MailerLite upserts). Treat both as success.
    if (res.status === 200 || res.status === 201) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, status: data?.data?.status || 'unconfirmed' }),
      };
    }

    // 422 = validation error (usually already-active subscriber in a different state)
    if (res.status === 422) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, already: true }),
      };
    }

    console.error('MailerLite error', res.status, data);
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Subscription service error. Please try again.' }),
    };
  } catch (err) {
    console.error('Subscribe function error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Something went wrong. Please try again.' }),
    };
  }
};

// Helper for Cloudflare Pages Functions
// Google Service Account OAuth2 with Web Crypto API

export async function getGoogleAccessToken(env) {
  // Parse credentials from Cloudflare environment variable
  let key;
  if (typeof env.SERVICE_ACCOUNT_KEY === 'string') {
    key = JSON.parse(env.SERVICE_ACCOUNT_KEY);
  } else if (env.SERVICE_ACCOUNT_KEY && typeof env.SERVICE_ACCOUNT_KEY === 'object') {
    key = env.SERVICE_ACCOUNT_KEY;
  } else {
    throw new Error("Missing SERVICE_ACCOUNT_KEY in environment variables");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp,
    iat: now
  };

  const str2ab = (str) => new TextEncoder().encode(str);
  const base64Url = (obj) => {
    const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const encodedHeader = base64Url(header);
  const encodedClaim = base64Url(claimSet);
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  // Import RSA Private Key
  const pem = key.private_key
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');

  const binaryDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    str2ab(signatureInput)
  );

  let binarySig = '';
  const sigBytes = new Uint8Array(signature);
  for (let i = 0; i < sigBytes.byteLength; i++) {
    binarySig += String.fromCharCode(sigBytes[i]);
  }
  const encodedSignature = btoa(binarySig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${signatureInput}.${encodedSignature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google OAuth error: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

export function parseProductDetails(raw) {
  if (!raw || typeof raw !== 'string') {
    return { unit: '-', packQty: '', maxStock: '', location: '', lastReceived: '', notes: '', raw: '' };
  }
  const str = raw.trim();
  let unit = '';
  let packQty = '';
  let maxStock = '';
  let location = '';
  let lastReceived = '';
  let notes = '';

  const dMatch = str.match(/D,([^, FLC]+)/i);
  if (dMatch) {
    lastReceived = dMatch[1].trim();
  } else {
    const dateMatch = str.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (dateMatch) lastReceived = dateMatch[1];
  }

  const fMatch = str.match(/F,([^, LDC]+)/i);
  if (fMatch) maxStock = fMatch[1].trim();

  const lMatch = str.match(/L,([^, FDC]+)/i);
  if (lMatch) location = lMatch[1].trim();

  const cMatch = str.match(/C,([^, FDL]+)/i);
  if (cMatch) notes = cMatch[1].trim();

  let clean = str
    .replace(/F,[^, LDC]*/gi, '')
    .replace(/L,[^, FDC]*/gi, '')
    .replace(/D,[^, FLC]*/gi, '')
    .replace(/C,[^, FDL]*/gi, '')
    .replace(/(\d{1,2}\/\d{1,2}\/\d{2,4})/g, '')
    .replace(/,\s*/g, ' ')
    .trim();

  if (clean.includes('/')) {
    const parts = clean.split('/');
    unit = parts[0].trim();
    packQty = parts.slice(1).join('/').trim();
  } else {
    unit = clean || '-';
  }

  return { unit: unit || '-', packQty, maxStock, location, lastReceived, notes, raw: str };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

import { config } from '../config.js';
import { ApiError } from '../lib/http.js';

/**
 * Safaricom Daraja (M-Pesa Express / STK Push) client.
 *
 * When no Daraja credentials are configured the client is never called: the
 * payment service records a simulated request instead. Real credentials are
 * read from the environment only, never from the database or the browser.
 */

let tokenCache = { token: null, expiresAt: 0 };

/** Timestamp in the YYYYMMDDHHmmss form Daraja expects, in Nairobi time. */
export function nairobiTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

export function stkPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

async function darajaFetch(path, options = {}) {
  const url = `${config.mpesa.baseUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(config.mpesa.timeoutMs),
    });
  } catch (error) {
    throw new ApiError(502, 'mpesa_unreachable', 'M-Pesa is not reachable right now. Please try again.', {
      reason: error.name,
    });
  }
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { response, data };
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now) return tokenCache.token;

  const credentials = Buffer.from(
    `${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`,
  ).toString('base64');

  const { response, data } = await darajaFetch('/oauth/v1/generate?grant_type=client_credentials', {
    method: 'GET',
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!response.ok || !data.access_token) {
    console.error('[mpesa] token request failed', response.status, data.errorMessage ?? data);
    throw new ApiError(502, 'mpesa_auth_failed', 'M-Pesa authentication failed. Check the Daraja credentials.');
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: now + Math.max(60, Number(data.expires_in ?? 3599) - 60) * 1000,
  };
  return tokenCache.token;
}

/** Sends the PIN prompt to the customer's phone. Returns Daraja's acknowledgement. */
export async function initiateStkPush({
  phone,
  amountKes,
  accountReference,
  description,
  callbackUrl = config.mpesa.callbackUrl,
}) {
  const token = await getAccessToken();
  const timestamp = nairobiTimestamp();
  const payload = {
    BusinessShortCode: config.mpesa.shortcode,
    Password: stkPassword(config.mpesa.shortcode, config.mpesa.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: config.mpesa.transactionType,
    Amount: Math.round(amountKes),
    PartyA: Number(phone),
    PartyB: Number(config.mpesa.shortcode),
    PhoneNumber: Number(phone),
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description || 'Wanasanaa order').slice(0, 13),
  };

  const { response, data } = await darajaFetch('/mpesa/stkpush/v1/processrequest', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || String(data.ResponseCode ?? '') !== '0') {
    console.error('[mpesa] stk push failed', response.status, data);
    throw new ApiError(502, 'mpesa_rejected', 'M-Pesa could not start the payment prompt.', {
      responseCode: data.ResponseCode,
      responseDescription: data.ResponseDescription || data.errorMessage || 'Unknown response',
    });
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    customerMessage: data.CustomerMessage,
    responseDescription: data.ResponseDescription,
  };
}

/** Queries the state of an STK push (used when a callback is delayed). */
export async function queryStkStatus(checkoutRequestId) {
  const token = await getAccessToken();
  const timestamp = nairobiTimestamp();
  const { response, data } = await darajaFetch('/mpesa/stkpushquery/v1/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.mpesa.shortcode,
      Password: stkPassword(config.mpesa.shortcode, config.mpesa.passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  if (!response.ok) {
    throw new ApiError(502, 'mpesa_query_failed', 'Could not check the M-Pesa payment status.');
  }
  return data;
}

/** Flattens Daraja's callback body into the fields the API needs. */
export function parseCallback(body) {
  const callback = body?.Body?.stkCallback;
  if (!callback?.CheckoutRequestID) return null;

  const items = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
  const metadata = Object.fromEntries(items.map((item) => [item.Name, item.Value]));

  return {
    checkoutRequestId: callback.CheckoutRequestID,
    merchantRequestId: callback.MerchantRequestID ?? null,
    resultCode: Number(callback.ResultCode),
    resultDesc: callback.ResultDesc ?? null,
    receipt: metadata.MpesaReceiptNumber != null ? String(metadata.MpesaReceiptNumber) : null,
    amount: metadata.Amount != null ? Number(metadata.Amount) : null,
    phone: metadata.PhoneNumber != null ? String(metadata.PhoneNumber) : null,
  };
}

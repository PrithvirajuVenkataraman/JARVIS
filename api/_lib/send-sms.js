/**
 * @file api/_lib/send-sms.js
 * @description Serverless SMS Dispatch Gateway.
 * Supports Twilio, Fast2SMS, Textlocal, and custom SMS Webhooks.
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: { code: 'method_not_allowed', message: 'Only POST supported.' } });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const to = String(body.to || body.phone || '').trim().replace(/[^\d+]/g, '');
    const message = String(body.message || body.locationMapsText || '').trim();

    if (!to || to.length < 10) {
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_recipient', message: 'A valid recipient phone number (at least 10 digits) is required.' }
        });
    }

    if (!message) {
        return res.status(400).json({
            success: false,
            error: { code: 'empty_message', message: 'Message content cannot be empty.' }
        });
    }

    // 1. Twilio Gateway
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

    if (twilioSid && twilioToken && twilioFrom) {
        try {
            const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`;
            const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
            const params = new URLSearchParams();
            params.append('To', to.startsWith('+') ? to : `+${to}`);
            params.append('From', twilioFrom);
            params.append('Body', message);

            const twilioRes = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString()
            });

            const data = await twilioRes.json();
            if (twilioRes.ok) {
                return res.status(200).json({ success: true, provider: 'twilio', sid: data.sid, status: data.status });
            }
            return res.status(502).json({ success: false, error: { code: 'twilio_error', message: data.message || 'Twilio delivery failed.' } });
        } catch (err) {
            return res.status(502).json({ success: false, error: { code: 'twilio_network_error', message: err.message } });
        }
    }

    // 2. Fast2SMS Gateway (popular Indian SMS gateway)
    const fast2smsKey = process.env.FAST2SMS_API_KEY;
    if (fast2smsKey) {
        try {
            const cleanDigits = to.replace(/[^\d]/g, '').slice(-10);
            const fastRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                method: 'POST',
                headers: {
                    'authorization': fast2smsKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    route: 'q',
                    message,
                    flash: 0,
                    numbers: cleanDigits
                })
            });
            const data = await fastRes.json();
            if (data?.return) {
                return res.status(200).json({ success: true, provider: 'fast2sms', request_id: data.request_id });
            }
            return res.status(502).json({ success: false, error: { code: 'fast2sms_error', message: data?.message?.[0] || 'Fast2SMS delivery failed.' } });
        } catch (err) {
            return res.status(502).json({ success: false, error: { code: 'fast2sms_network_error', message: err.message } });
        }
    }

    // 3. Custom Webhook Gateway
    const customGateway = process.env.SMS_GATEWAY_URL;
    if (customGateway) {
        try {
            const gwRes = await fetch(customGateway, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, message })
            });
            if (gwRes.ok) {
                return res.status(200).json({ success: true, provider: 'custom_gateway' });
            }
        } catch (err) {
            return res.status(502).json({ success: false, error: { code: 'custom_gateway_error', message: err.message } });
        }
    }

    // If no carrier SMS gateway is configured in environment:
    return res.status(200).json({
        success: false,
        gatewayConfigured: false,
        code: 'gateway_not_configured',
        message: 'No carrier SMS gateway API key (Twilio / Fast2SMS) configured on server. Use direct SMS client or WhatsApp.'
    });
}

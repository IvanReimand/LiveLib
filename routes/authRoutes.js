const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const db = require('../config/db');

const router = express.Router();
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_DELAY_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'livelib_session';
const PASSWORD_HASH_BYTES = 64;

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) {
                reject(error);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(row);
        });
    });
}

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email) {
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sessionSecret() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || Array.from(secret).length < 8) {
        throw new Error('SESSION_SECRET must be set to a random value of at least 8 characters.');
    }
    return secret;
}

function mailTransport() {
    const { SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) {
        throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM.');
    }

    const port = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('SMTP_PORT must be a valid port number.');
    }

    return {
        transport: nodemailer.createTransport({
            host: SMTP_HOST,
            port,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: SMTP_USER, pass: SMTP_PASS }
        }),
        from: MAIL_FROM
    };
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, PASSWORD_HASH_BYTES, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
        });
    });
}

function verifyPassword(password, storedHash) {
    const [algorithm, saltHex, hashHex] = storedHash.split('$');
    if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(hashHex)) {
        const supplied = Buffer.from(password);
        const stored = Buffer.from(storedHash);
        return Promise.resolve(supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored));
    }

    return new Promise((resolve, reject) => {
        crypto.scrypt(password, Buffer.from(saltHex, 'hex'), PASSWORD_HASH_BYTES, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(crypto.timingSafeEqual(derivedKey, Buffer.from(hashHex, 'hex')));
        });
    });
}

function codeDigest(email, code) {
    return crypto.createHmac('sha256', sessionSecret()).update(`${email}:${code}`).digest('hex');
}

function createSessionToken(userId) {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const payload = Buffer.from(`${userId}.${expiresAt}`).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
    return { token: `${payload}.${signature}`, expiresAt };
}

function setSessionCookie(res, userId) {
    const { token, expiresAt } = createSessionToken(userId);
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        expires: new Date(expiresAt),
        path: '/'
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
    });
}

function cookieValue(req, name) {
    const prefix = `${name}=`;
    const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    if (!cookie) {
        return '';
    }
    try {
        return decodeURIComponent(cookie.slice(prefix.length));
    } catch (error) {
        return '';
    }
}

function readSession(req) {
    const token = cookieValue(req, SESSION_COOKIE);
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) {
        return null;
    }

    let expectedSignature;
    try {
        expectedSignature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest();
    } catch (error) {
        return null;
    }

    let providedSignature;
    try {
        providedSignature = Buffer.from(signature, 'base64url');
    } catch (error) {
        return null;
    }
    if (providedSignature.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(providedSignature, expectedSignature)) {
        return null;
    }

    try {
        const [userIdText, expiresAtText, payloadExtra] = Buffer.from(payload, 'base64url').toString().split('.');
        const userId = Number(userIdText);
        const expiresAt = Number(expiresAtText);
        if (payloadExtra || !Number.isSafeInteger(userId) || userId < 1 ||
            !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
            return null;
        }
        return userId;
    } catch (error) {
        return null;
    }
}

function requireAuth(req, res, next) {
    const userId = readSession(req);
    if (!userId) {
        return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    req.userId = userId;
    return next();
}

async function sendVerificationCode(email, code) {
    const { transport, from } = mailTransport();
    await transport.sendMail({
        from,
        to: email,
        subject: 'Your LiveLib security code',
        text: `Your LiveLib security code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
        html: `<p>Your LiveLib security code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`
    });
}

async function issueCode(email) {
    const previous = await get(
        'SELECT last_sent_at FROM email_verification_codes WHERE email = ?',
        [email]
    );
    const now = Date.now();
    if (previous && now - previous.last_sent_at < CODE_RESEND_DELAY_MS) {
        return { rateLimited: true };
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    await run(
        `INSERT INTO email_verification_codes (email, code_hash, expires_at, attempts, last_sent_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(email) DO UPDATE SET
            code_hash = excluded.code_hash,
            expires_at = excluded.expires_at,
            attempts = 0,
            last_sent_at = excluded.last_sent_at`,
        [email, codeDigest(email, code), now + CODE_TTL_MS, now]
    );
    try {
        await sendVerificationCode(email, code);
    } catch (error) {
        await run('DELETE FROM email_verification_codes WHERE email = ?', [email]);
        throw new Error('Email could not be sent. Check the SMTP settings and try again.');
    }
    return { rateLimited: false };
}

router.post('/register', async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    if (!validEmail(email) || typeof password !== 'string' ||
        password.length < 8 || Buffer.byteLength(password) > 128) {
        return res.status(400).json({ error: 'Enter a valid email and a password of at least 8 characters.' });
    }

    try {
        sessionSecret();
        mailTransport();
        const existing = await get('SELECT id, email_verified FROM users WHERE email = ?', [email]);
        if (existing && existing.email_verified) {
            return res.status(409).json({ error: 'An account already exists for this email. Please sign in.' });
        }
        const previousCode = await get(
            'SELECT last_sent_at FROM email_verification_codes WHERE email = ?',
            [email]
        );
        if (previousCode && Date.now() - previousCode.last_sent_at < CODE_RESEND_DELAY_MS) {
            return res.status(429).json({ error: 'A code was sent recently. Please wait a minute before requesting another.' });
        }

        const passwordHash = await hashPassword(password);
        if (existing) {
            await run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, existing.id]);
        } else {
            await run(
                'INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, 0)',
                [email, email, passwordHash]
            );
        }

        const result = await issueCode(email);
        if (result.rateLimited) {
            return res.status(429).json({ error: 'A code was sent recently. Please wait a minute before requesting another.' });
        }
        return res.status(201).json({ message: 'A security code has been sent to your email.', email });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'An account already exists for this email. Please sign in.' });
        }
        console.error('Registration error:', error);
        return res.status(error.message.includes('not configured') || error.message.includes('SESSION_SECRET') || error.message.includes('Email could not be sent') ? 503 : 500)
            .json({ error: error.message.includes('not configured') || error.message.includes('SESSION_SECRET') || error.message.includes('Email could not be sent')
                ? error.message
                : 'Registration could not be completed. Please try again later.' });
    }
});

router.post('/verify', async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!validEmail(email) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'Enter the email address and 6-digit code.' });
    }

    try {
        sessionSecret();
        const user = await get('SELECT id, username, email, email_verified FROM users WHERE email = ?', [email]);
        const challenge = await get('SELECT * FROM email_verification_codes WHERE email = ?', [email]);
        if (!user || !challenge) {
            return res.status(400).json({ error: 'This code is invalid or has expired. Request a new code.' });
        }
        if (challenge.expires_at <= Date.now()) {
            await run('DELETE FROM email_verification_codes WHERE email = ?', [email]);
            return res.status(400).json({ error: 'This code has expired. Request a new code.' });
        }
        if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
            return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
        }

        const provided = Buffer.from(codeDigest(email, code), 'hex');
        const expected = Buffer.from(challenge.code_hash, 'hex');
        if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
            await run('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ?', [email]);
            return res.status(400).json({ error: 'That code is incorrect. Please check the email and try again.' });
        }

        if (!user.email_verified) {
            await run('UPDATE users SET email_verified = 1 WHERE id = ?', [user.id]);
        }
        await run('DELETE FROM email_verification_codes WHERE email = ?', [email]);
        setSessionCookie(res, user.id);
        return res.json({
            message: 'Your security code is confirmed.',
            user: { id: user.id, email: user.email, username: user.username }
        });
    } catch (error) {
        console.error('Email verification error:', error);
        return res.status(error.message.includes('SESSION_SECRET') ? 503 : 500)
            .json({ error: error.message.includes('SESSION_SECRET') ? error.message : 'Verification could not be completed. Please try again later.' });
    }
});

router.post('/resend-code', async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!validEmail(email)) {
        return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    try {
        sessionSecret();
        mailTransport();
        const user = await get('SELECT email_verified FROM users WHERE email = ?', [email]);
        const challenge = await get('SELECT email FROM email_verification_codes WHERE email = ?', [email]);
        if (!user || (user.email_verified && !challenge)) {
            return res.json({ message: 'If an account with an active security code exists, a new code will be sent.' });
        }

        const result = await issueCode(email);
        if (result.rateLimited) {
            return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
        }
        return res.json({ message: 'A new security code has been sent.' });
    } catch (error) {
        console.error('Resend verification code error:', error);
        return res.status(error.message.includes('not configured') || error.message.includes('SESSION_SECRET') || error.message.includes('Email could not be sent') ? 503 : 500)
            .json({ error: error.message.includes('not configured') || error.message.includes('SESSION_SECRET') || error.message.includes('Email could not be sent')
                ? error.message
                : 'A new code could not be sent. Please try again later.' });
    }
});

router.post('/login', async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    if (!validEmail(email) || typeof password !== 'string' || password.length === 0 || Buffer.byteLength(password) > 128) {
        return res.status(400).json({ error: 'Enter a valid email and password.' });
    }

    try {
        sessionSecret();
        const user = await get('SELECT id, username, email, password_hash, email_verified FROM users WHERE email = ?', [email]);
        if (!user || !(await verifyPassword(password, user.password_hash))) {
            return res.status(401).json({ error: 'The email or password is incorrect.' });
        }
        if (!user.email_verified) {
            return res.status(403).json({ error: 'Verify your email before signing in.' });
        }
        if (!user.password_hash.startsWith('scrypt$')) {
            const passwordHash = await hashPassword(password);
            await run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
        }

        const result = await issueCode(email);
        if (result.rateLimited) {
            return res.status(429).json({ error: 'A code was sent recently. Please wait a minute before requesting another.' });
        }
        return res.json({
            message: 'A sign-in security code has been sent to your email.',
            email: user.email
        });
    } catch (error) {
        console.error('Sign-in error:', error);
        const configurationError = error.message.includes('SESSION_SECRET') || error.message.includes('not configured');
        const deliveryError = error.message.includes('Email could not be sent');
        return res.status(configurationError || deliveryError ? 503 : 500)
            .json({ error: configurationError || deliveryError
                ? error.message
                : 'Sign-in could not be completed. Please try again later.' });
    }
});

router.get('/me', async (req, res) => {
    const userId = readSession(req);
    if (!userId) {
        return res.json({ user: null });
    }

    try {
        const user = await get('SELECT id, username, email FROM users WHERE id = ? AND email_verified = 1', [userId]);
        if (!user) {
            clearSessionCookie(res);
            return res.json({ user: null });
        }
        return res.json({ user });
    } catch (error) {
        console.error('Session lookup error:', error);
        return res.status(500).json({ error: 'Your session could not be checked. Please try again later.' });
    }
});

router.post('/logout', (req, res) => {
    clearSessionCookie(res);
    return res.json({ message: 'Signed out.' });
});

module.exports = { router, requireAuth };

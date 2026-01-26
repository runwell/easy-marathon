/**
 * Garmin Connect Platform Integration
 *
 * Handles authentication and activity fetching from Garmin Connect.
 * Uses direct API calls similar to the garth library approach.
 */

export class GarminPlatform {
    static NAME = 'Garmin Connect';
    static SUPPORTED = true;
    static HAS_OAUTH = false; // Garmin doesn't have public OAuth

    // Garmin API endpoints
    static SSO_URL = 'https://sso.garmin.com/sso';
    static SSO_EMBED_URL = 'https://sso.garmin.com/sso/embed';
    static CONNECT_URL = 'https://connect.garmin.com';
    static MODERN_URL = 'https://connect.garmin.com/modern';
    static SIGNIN_URL = 'https://sso.garmin.com/sso/signin';
    static CONNECT_API_URL = 'https://connectapi.garmin.com';
    static OAUTH_CONSUMER_URL = 'https://thegarth.s3.amazonaws.com/oauth_consumer.json';
    static MOBILE_USER_AGENT = 'com.garmin.android.apps.connectmobile';

    constructor(env) {
        this.env = env;
        this.cookies = new Map();
        this.oauthConsumer = null;
    }

    /**
     * Authenticate with Garmin Connect
     * @param {Object} credentials - { email, password }
     * @returns {Object} Session data
     */
    async authenticate(credentials) {
        const {email, password} = credentials;

        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        // Reset cookies for fresh login
        this.cookies = new Map();
        this.authDebug = [];

        const logAuth = (step, data) => {
            this.authDebug.push({step, data, time: new Date().toISOString()});
            console.log(`[AUTH ${step}]`, JSON.stringify(data).substring(0, 500));
        };

        try {
            // Step 1: Get CSRF token and cookies from SSO
            logAuth('csrf-start', {});
            const csrfData = await this.getCSRFToken();
            logAuth('csrf-done', {tokenLength: csrfData.csrf?.length, cookieCount: this.cookies.size});

            // Step 2: Submit login form
            logAuth('login-start', {email: email.substring(0, 3) + '***'});
            const loginResult = await this.submitLogin(email, password, csrfData);
            logAuth('login-done', {
                hasTicket: !!loginResult.ticket,
                ticketPreview: loginResult.ticket?.substring(0, 20)
            });

            // Step 3: Exchange ticket for session
            logAuth('exchange-start', {cookieCount: this.cookies.size});
            const session = await this.exchangeTicket(loginResult.ticket);
            logAuth('exchange-done', {
                hasOAuth1: !!session.oauth1,
                hasOAuth2: !!session.oauth2,
                hasJwtFgp: !!session.jwtFgp,
                hasJwtWeb: !!session.jwtWeb,
                oauth1Preview: session.oauth1 ? session.oauth1.substring(0, 20) + '...' : null,
                jwtFgpPreview: session.jwtFgp ? session.jwtFgp.substring(0, 20) + '...' : null,
                cookieNames: Object.keys(session.allCookies || {}),
                cookieCount: Object.keys(session.allCookies || {}).length
            });

            // Step 4: Exchange ticket for OAuth tokens (used by connectapi)
            let oauthTokens = null;
            try {
                logAuth('oauth-start', {});
                oauthTokens = await this.getOAuthTokens(loginResult.ticket);
                logAuth('oauth-done', {
                    hasOauth1Token: !!oauthTokens?.oauth1?.oauth_token,
                    hasOauth2AccessToken: !!oauthTokens?.oauth2?.access_token,
                    tokenType: oauthTokens?.oauth2?.token_type,
                    expiresIn: oauthTokens?.oauth2?.expires_in
                });
            } catch (oauthError) {
                logAuth('oauth-error', {message: oauthError.message});
            }

            // Log final state with more detail
            const cookieDetails = {};
            for (const [name, value] of this.cookies) {
                cookieDetails[name] = value ? `has value (len:${value.length})` : 'EMPTY';
            }
            logAuth('final', {
                cookiesInMap: [...this.cookies.keys()],
                cookieDetails: cookieDetails,
                allCookiesStored: Object.keys(session.allCookies || {})
            });

            // Create session token (base64 encoded for transport)
            const sessionToken = this.base64EncodeUtf8(JSON.stringify({
                platform: 'garmin',
                credentials: {
                    oauth1: session.oauth1,
                    oauth2: session.oauth2,
                    oauth1Token: oauthTokens?.oauth1?.oauth_token,
                    oauth1TokenSecret: oauthTokens?.oauth1?.oauth_token_secret,
                    oauth1MfaToken: oauthTokens?.oauth1?.mfa_token,
                    oauth2AccessToken: oauthTokens?.oauth2?.access_token,
                    oauth2RefreshToken: oauthTokens?.oauth2?.refresh_token,
                    oauth2ExpiresAt: oauthTokens?.oauth2?.expires_at,
                    oauth2TokenType: oauthTokens?.oauth2?.token_type,
                    jwtFgp: session.jwtFgp,
                    jwtWeb: session.jwtWeb,
                    cookies: session.allCookies
                },
                authDebug: this.authDebug, // Include debug info in session for troubleshooting
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
            }));

            return {
                token: sessionToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                displayName: session.displayName || email.split('@')[0]
            };

        } catch (error) {
            console.error('Garmin authentication error:', error.message, error.stack);
            console.error('Auth debug:', JSON.stringify(this.authDebug));
            // Re-throw with the actual error message for better debugging
            if (error.message.includes('Invalid') || error.message.includes('credentials')) {
                throw error;
            }
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    /**
     * Parse all Set-Cookie headers from a response
     * Cloudflare Workers' headers.get('set-cookie') only returns the first cookie
     * We need to use headers.getSetCookie() if available, or parse manually
     */
    parseSetCookies(response) {
        const cookies = [];

        // Try getSetCookie() first (available in newer Workers runtime)
        if (typeof response.headers.getSetCookie === 'function') {
            cookies.push(...response.headers.getSetCookie());
        } else {
            // Fallback: get all set-cookie headers
            // Note: In Workers, this may only return the first one
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) {
                // Try to split if multiple cookies are combined
                cookies.push(...setCookie.split(/,(?=\s*\w+=)/));
            }
        }

        // Parse and store cookies - only store non-empty values
        // Empty values usually mean "delete this cookie"
        for (const cookie of cookies) {
            const match = cookie.match(/^([^=]+)=([^;]*)/);
            if (match) {
                const name = match[1].trim();
                const value = match[2].trim();
                // Only store if value is non-empty, OR update existing with new value
                if (value && value.length > 0) {
                    this.cookies.set(name, value);
                }
                // Don't overwrite existing cookies with empty values
            }
        }

        return cookies;
    }

    /**
     * Get cookie string for requests
     */
    getCookieString() {
        const parts = [];
        for (const [name, value] of this.cookies) {
            parts.push(`${name}=${value}`);
        }
        return parts.join('; ');
    }

    /**
     * Get CSRF token from Garmin SSO
     */
    async getCSRFToken() {
        const embedParams = new URLSearchParams({
            id: 'gauth-widget',
            embedWidget: 'true',
            gauthHost: GarminPlatform.SSO_URL
        });

        const signinParams = {
            id: 'gauth-widget',
            embedWidget: 'true',
            gauthHost: GarminPlatform.SSO_EMBED_URL,
            service: GarminPlatform.SSO_EMBED_URL,
            source: GarminPlatform.SSO_EMBED_URL,
            redirectAfterAccountLoginUrl: GarminPlatform.SSO_EMBED_URL,
            redirectAfterAccountCreationUrl: GarminPlatform.SSO_EMBED_URL
        };

        // Step 1: Load the embed page to set initial cookies
        const embedResponse = await fetch(`${GarminPlatform.SSO_EMBED_URL}?${embedParams}`, {
            headers: {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        if (!embedResponse.ok) {
            throw new Error(`Failed to load SSO embed: HTTP ${embedResponse.status}`);
        }

        this.parseSetCookies(embedResponse);
        await embedResponse.text();

        const params = new URLSearchParams(signinParams);

        const response = await fetch(`${GarminPlatform.SIGNIN_URL}?${params}`, {
            headers: {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cookie': this.getCookieString()
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get CSRF token: HTTP ${response.status}`);
        }

        // Parse cookies from response
        this.parseSetCookies(response);

        const html = await response.text();

        // Try multiple patterns for CSRF token
        let csrfToken = null;

        // Pattern 1: name="_csrf" value="..."
        let match = html.match(/name="_csrf"\s+value="([^"]+)"/);
        if (match) csrfToken = match[1];

        // Pattern 2: value="..." name="_csrf"
        if (!csrfToken) {
            match = html.match(/value="([^"]+)"\s+name="_csrf"/);
            if (match) csrfToken = match[1];
        }

        // Pattern 3: Look for csrf in a script tag or JSON
        if (!csrfToken) {
            match = html.match(/"_csrf"\s*:\s*"([^"]+)"/);
            if (match) csrfToken = match[1];
        }

        // Pattern 4: Hidden input with id="_csrf"
        if (!csrfToken) {
            match = html.match(/id="_csrf"[^>]*value="([^"]+)"/);
            if (match) csrfToken = match[1];
        }

        if (!csrfToken) {
            console.error('HTML snippet for debugging:', html.substring(0, 2000));
            throw new Error('CSRF token not found in response');
        }

        return {
            csrf: csrfToken,
            signinParams
        };
    }

    /**
     * Submit login credentials
     */
    async submitLogin(email, password, csrfData) {
        const params = new URLSearchParams(csrfData.signinParams || {
            id: 'gauth-widget',
            embedWidget: 'true',
            gauthHost: GarminPlatform.SSO_EMBED_URL,
            service: GarminPlatform.SSO_EMBED_URL,
            source: GarminPlatform.SSO_EMBED_URL,
            redirectAfterAccountLoginUrl: GarminPlatform.SSO_EMBED_URL,
            redirectAfterAccountCreationUrl: GarminPlatform.SSO_EMBED_URL
        });

        const formData = new URLSearchParams({
            username: email,
            password: password,
            embed: 'true',
            _csrf: csrfData.csrf
        });

        const response = await fetch(`${GarminPlatform.SIGNIN_URL}?${params}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Cookie': this.getCookieString(),
                'Origin': 'https://sso.garmin.com',
                'Referer': `${GarminPlatform.SIGNIN_URL}?${params}`
            },
            body: formData.toString(),
            redirect: 'manual'
        });

        // Parse cookies from response
        this.parseSetCookies(response);

        // Check for redirect (successful login)
        const location = response.headers.get('location') || '';
        const responseText = await response.text();

        console.log('Login response status:', response.status);
        console.log('Login response location:', location);

        // Extract ticket from response or location header
        let ticketMatch = location.match(/ticket=([^&"]+)/);
        if (!ticketMatch) {
            ticketMatch = responseText.match(/ticket=([^&"<\s]+)/);
        }
        if (!ticketMatch) {
            ticketMatch = responseText.match(/var defined_ticket\s*=\s*['"]([^'"]+)['"]/);
        }
        if (!ticketMatch) {
            ticketMatch = responseText.match(/"ticket"\s*:\s*"([^"]+)"/);
        }
        if (!ticketMatch) {
            ticketMatch = responseText.match(/embed\?ticket=([^"&\s]+)/);
        }

        if (!ticketMatch) {
            // Check for error message in response
            if (responseText.includes('credentials are incorrect') ||
                responseText.includes('Invalid') ||
                responseText.includes('locked') ||
                responseText.includes('error')) {

                // Try to extract specific error message
                const errorMatch = responseText.match(/class="error[^"]*"[^>]*>([^<]+)</);
                if (errorMatch) {
                    throw new Error(errorMatch[1].trim());
                }
                throw new Error('Invalid email or password');
            }

            console.error('Response text snippet:', responseText.substring(0, 3000));
            throw new Error('Login failed - no ticket received. Garmin may have updated their login flow.');
        }

        return {
            ticket: ticketMatch[1]
        };
    }

    /**
     * Exchange ticket for OAuth tokens
     */
    async exchangeTicket(ticket) {
        console.log('Exchanging ticket, current cookies:', this.getCookieString().substring(0, 200));

        // Exchange ticket for session
        const response = await fetch(
            `${GarminPlatform.MODERN_URL}/?ticket=${ticket}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Cookie': this.getCookieString()
                },
                redirect: 'manual'
            }
        );

        console.log('Ticket exchange response status:', response.status);

        // Log ALL headers to see what Garmin returns
        const allHeaders = {};
        response.headers.forEach((value, key) => {
            allHeaders[key] = value;
        });
        console.log('Response headers:', JSON.stringify(allHeaders));

        // Parse cookies from response
        this.parseSetCookiesVerbose(response, 'ticket-exchange');

        // Follow redirects manually to collect all cookies
        let redirectUrl = response.headers.get('location');
        let maxRedirects = 5;
        let redirectCount = 0;

        while (redirectUrl && maxRedirects > 0) {
            redirectCount++;
            console.log(`Redirect ${redirectCount} to:`, redirectUrl);

            // Handle relative URLs
            if (redirectUrl.startsWith('/')) {
                const baseUrl = new URL(GarminPlatform.CONNECT_URL);
                redirectUrl = baseUrl.origin + redirectUrl;
            }

            const redirectResponse = await fetch(redirectUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Cookie': this.getCookieString()
                },
                redirect: 'manual'
            });

            console.log(`Redirect ${redirectCount} status:`, redirectResponse.status);
            this.parseSetCookiesVerbose(redirectResponse, `redirect-${redirectCount}`);

            redirectUrl = redirectResponse.headers.get('location');
            maxRedirects--;
        }

        // Debug: Log all cookie names and value lengths
        console.log('Final cookies in map:');
        for (const [name, value] of this.cookies) {
            console.log(`  ${name}: ${value ? value.substring(0, 30) + '... (len:' + value.length + ')' : 'EMPTY'}`);
        }

        // Get OAuth tokens from cookies (try multiple possible names)
        const oauth1 = this.cookies.get('GARMIN-SSO-CUST-GUID') || this.cookies.get('GARMIN-SSO-GUID');
        const oauth2 = this.cookies.get('SESSIONID') || this.cookies.get('SESSION') || this.cookies.get('session');

        // Also get JWT tokens which Garmin now uses
        const jwtFgp = this.cookies.get('JWT_FGP');
        const jwtWeb = this.cookies.get('JWT_WEB');

        console.log('Key tokens found:');
        console.log('  oauth1 (GARMIN-SSO-CUST-GUID):', oauth1 ? `${oauth1.substring(0, 20)}... (len:${oauth1.length})` : 'MISSING');
        console.log('  oauth2 (SESSIONID):', oauth2 ? `${oauth2.substring(0, 20)}... (len:${oauth2.length})` : 'MISSING');
        console.log('  JWT_FGP:', jwtFgp ? `${jwtFgp.substring(0, 20)}... (len:${jwtFgp.length})` : 'MISSING');
        console.log('  JWT_WEB:', jwtWeb ? `${jwtWeb.substring(0, 20)}... (len:${jwtWeb.length})` : 'MISSING');

        // Collect ALL cookies for future API calls - include even empty ones for debugging
        const allCookies = {};
        const emptyCookies = [];
        for (const [name, value] of this.cookies) {
            if (value && value.length > 0) {
                allCookies[name] = value;
            } else {
                emptyCookies.push(name);
            }
        }

        console.log('Cookies with values:', Object.keys(allCookies).join(', '));
        console.log('Cookies with EMPTY values:', emptyCookies.join(', '));

        // Check if we have enough auth data
        const hasAuth = oauth1 || jwtFgp || jwtWeb || Object.keys(allCookies).length > 3;
        if (!hasAuth) {
            console.log('WARNING: May not have enough authentication cookies');
        }

        return {
            oauth1,
            oauth2,
            jwtFgp,
            jwtWeb,
            allCookies,
            displayName: null
        };
    }

    /**
     * Fetch Garmin OAuth consumer key/secret
     */
    async getOAuthConsumer() {
        if (this.oauthConsumer) return this.oauthConsumer;

        const response = await fetch(GarminPlatform.OAUTH_CONSUMER_URL, {
            headers: {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch OAuth consumer: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data.consumer_key || !data.consumer_secret) {
            throw new Error('Invalid OAuth consumer response');
        }

        this.oauthConsumer = data;
        return data;
    }

    /**
     * OAuth 1.0 encoding (RFC 3986)
     */
    oauthEncode(value) {
        return encodeURIComponent(String(value))
            .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    }

    /**
     * Generate OAuth 1.0 Authorization header
     */
    async buildOAuth1Header(method, url, token, tokenSecret, extraParams = {}) {
        const {consumer_key, consumer_secret} = await this.getOAuthConsumer();
        const nonce = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + Date.now();
        const timestamp = Math.floor(Date.now() / 1000).toString();

        const oauthParams = {
            oauth_consumer_key: consumer_key,
            oauth_nonce: nonce,
            oauth_signature_method: 'HMAC-SHA1',
            oauth_timestamp: timestamp,
            oauth_version: '1.0'
        };

        if (token) {
            oauthParams.oauth_token = token;
        }

        const urlObj = new URL(url);
        const queryParams = {};
        urlObj.searchParams.forEach((value, key) => {
            queryParams[key] = value;
        });

        const signatureParams = {
            ...queryParams,
            ...extraParams,
            ...oauthParams
        };

        const normalizedParams = Object.entries(signatureParams)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [this.oauthEncode(key), this.oauthEncode(value)])
            .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
            .map(([key, value]) => `${key}=${value}`)
            .join('&');

        const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
        const baseString = [
            method.toUpperCase(),
            this.oauthEncode(baseUrl),
            this.oauthEncode(normalizedParams)
        ].join('&');

        const signingKey = `${this.oauthEncode(consumer_secret)}&${this.oauthEncode(tokenSecret || '')}`;
        const signature = await this.hmacSha1Base64(signingKey, baseString);

        oauthParams.oauth_signature = signature;

        const headerParams = Object.entries(oauthParams)
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([key, value]) => `${this.oauthEncode(key)}="${this.oauthEncode(value)}"`)
            .join(', ');

        return `OAuth ${headerParams}`;
    }

    /**
     * HMAC-SHA1 base64 helper
     */
    async hmacSha1Base64(key, data) {
        const encoder = new TextEncoder();
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(key),
            {name: 'HMAC', hash: 'SHA-1'},
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
        const bytes = new Uint8Array(signature);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Base64 encode UTF-8 safely (handles non-Latin1)
     */
    base64EncodeUtf8(value) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(value);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Exchange service ticket for OAuth tokens (matches garth flow)
     */
    async getOAuthTokens(ticket) {
        const preauthUrl = `${GarminPlatform.CONNECT_API_URL}/oauth-service/oauth/preauthorized` +
            `?ticket=${encodeURIComponent(ticket)}` +
            `&login-url=${encodeURIComponent(GarminPlatform.SSO_EMBED_URL)}` +
            `&accepts-mfa-tokens=true`;

        const preauthAuth = await this.buildOAuth1Header('GET', preauthUrl);
        const preauthCookies = this.getCookieString();
        const preauthResponse = await fetch(preauthUrl, {
            headers: {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Accept': 'application/x-www-form-urlencoded, text/plain, */*',
                'Authorization': preauthAuth,
                'Cookie': preauthCookies
            }
        });

        if (!preauthResponse.ok) {
            const errorText = await preauthResponse.text();
            const safeText = errorText.replace(/\s+/g, ' ').trim().substring(0, 200);
            throw new Error(`OAuth preauthorization failed: HTTP ${preauthResponse.status} ${safeText}`);
        }

        const preauthText = await preauthResponse.text();
        const preauthParams = new URLSearchParams(preauthText);
        const oauth1 = {
            oauth_token: preauthParams.get('oauth_token'),
            oauth_token_secret: preauthParams.get('oauth_token_secret'),
            mfa_token: preauthParams.get('mfa_token')
        };

        if (!oauth1.oauth_token || !oauth1.oauth_token_secret) {
            throw new Error('OAuth preauthorization returned incomplete token');
        }

        const exchangeUrl = `${GarminPlatform.CONNECT_API_URL}/oauth-service/oauth/exchange/user/2.0`;
        const bodyParams = {};
        if (oauth1.mfa_token) {
            bodyParams.mfa_token = oauth1.mfa_token;
        }
        const body = new URLSearchParams(bodyParams).toString();

        const authHeader = await this.buildOAuth1Header(
            'POST',
            exchangeUrl,
            oauth1.oauth_token,
            oauth1.oauth_token_secret,
            bodyParams
        );

        const exchangeResponse = await fetch(exchangeUrl, {
            method: 'POST',
            headers: {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': authHeader
            },
            body: body
        });

        if (!exchangeResponse.ok) {
            const errorText = await exchangeResponse.text();
            throw new Error(`OAuth exchange failed: HTTP ${exchangeResponse.status} ${errorText.substring(0, 200)}`);
        }

        const oauth2 = await exchangeResponse.json();
        const now = Math.floor(Date.now() / 1000);
        if (oauth2.expires_in && !oauth2.expires_at) {
            oauth2.expires_at = now + oauth2.expires_in;
        }
        if (oauth2.refresh_token_expires_in && !oauth2.refresh_token_expires_at) {
            oauth2.refresh_token_expires_at = now + oauth2.refresh_token_expires_in;
        }
        return {oauth1, oauth2};
    }

    /**
     * Parse cookies with verbose logging
     */
    parseSetCookiesVerbose(response, context) {
        console.log(`[${context}] Parsing cookies...`);

        // Method 1: Try getSetCookie() - this is the reliable method in Workers
        if (typeof response.headers.getSetCookie === 'function') {
            const cookies = response.headers.getSetCookie();
            console.log(`[${context}] getSetCookie() returned ${cookies.length} cookies`);

            // Log important Garmin cookies specifically
            const garminCookies = cookies.filter(c =>
                c.includes('GARMIN') || c.includes('JWT') || c.includes('SESSIONID')
            );
            if (garminCookies.length > 0) {
                console.log(`[${context}] *** GARMIN COOKIES FOUND: ${garminCookies.length} ***`);
                garminCookies.forEach((cookie, i) => {
                    console.log(`[${context}] Garmin cookie ${i}: ${cookie.substring(0, 200)}`);
                });
            }

            cookies.forEach((cookie, i) => {
                this.parseSingleCookieVerbose(cookie, context);
            });
        } else {
            console.log(`[${context}] getSetCookie() not available, trying fallback`);

            // Fallback: Try get('set-cookie')
            const setCookieHeader = response.headers.get('set-cookie');
            if (setCookieHeader) {
                console.log(`[${context}] set-cookie header: ${setCookieHeader.substring(0, 200)}`);
                this.parseSingleCookieVerbose(setCookieHeader, context);
            }
        }
    }

    /**
     * Parse a single cookie string with verbose output
     */
    parseSingleCookieVerbose(cookieString, context) {
        if (!cookieString) return;

        // Cookie format: name=value; attr1; attr2=val; ...
        // We only want the name=value part
        const firstPart = cookieString.split(';')[0].trim();
        const eqIndex = firstPart.indexOf('=');

        if (eqIndex > 0) {
            const name = firstPart.substring(0, eqIndex).trim();
            const value = firstPart.substring(eqIndex + 1).trim();

            // Log important cookies even if empty
            const isImportant = name.includes('GARMIN') || name.includes('JWT') || name === 'SESSIONID' || name === 'SESSION';

            if (isImportant) {
                console.log(`[${context}] *** IMPORTANT COOKIE: ${name} = "${value}" (len: ${value.length}) ***`);
            }

            // Skip empty values and some attributes that look like cookies
            if (value && name && !name.toLowerCase().startsWith('path') && !name.toLowerCase().startsWith('domain')) {
                console.log(`[${context}] Storing: ${name} = ${value.substring(0, 50)}${value.length > 50 ? '...' : ''} (len: ${value.length})`);
                this.cookies.set(name, value);
            } else if (isImportant) {
                console.log(`[${context}] WARNING: Important cookie ${name} has empty value - NOT storing`);
            }
        }
    }

    /**
     * Extract a specific cookie value
     */
    extractCookieValue(cookieString, name) {
        const match = cookieString.match(new RegExp(`${name}=([^;]+)`));
        return match ? match[1] : null;
    }

    /**
     * Validate an existing session
     */
    async validateSession(credentials) {
        // For Garmin, we try to make a simple API call to verify the session
        try {
            if (!credentials) return false;

            const accessToken = this.getOAuthAccessToken(credentials);
            if (accessToken) {
                const response = await fetch(
                    `${GarminPlatform.CONNECT_API_URL}/userprofile-service/socialProfile`,
                    {
                        headers: {
                            'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                            'Authorization': `${accessToken.tokenType} ${accessToken.token}`,
                            'Accept': 'application/json',
                            'Accept-Language': 'en-US,en;q=0.9'
                        }
                    }
                );

                return response.ok;
            }

            const cookieString = this.buildCookieString(credentials);
            if (!cookieString) return false;

            const response = await fetch(
                `${GarminPlatform.CONNECT_URL}/proxy/userprofile-service/socialProfile`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Cookie': cookieString,
                        'NK': 'NT',
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'DI-Backend': 'connectapi.garmin.com'
                    }
                }
            );

            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Fetch activities from Garmin Connect
     */
    async fetchActivities(credentials, startDate, endDate, debugMode = false) {
        const debugInfo = {
            steps: [],
            credentialKeys: Object.keys(credentials || {}),
            dateRange: {startDate, endDate}
        };

        const addDebug = (step, data) => {
            debugInfo.steps.push({step, data, time: new Date().toISOString()});
            console.log(`[${step}]`, typeof data === 'object' ? JSON.stringify(data).substring(0, 500) : data);
        };

        addDebug('start', {credentialKeys: debugInfo.credentialKeys});

        // Build cookie string from credentials
        const cookieString = this.buildCookieString(credentials);
        const accessToken = this.getOAuthAccessToken(credentials);
        addDebug('cookies', {
            cookieLength: cookieString.length,
            cookiePreview: cookieString ? cookieString.substring(0, 100) + '...' : '',
            hasCookies: cookieString.length > 0
        });
        addDebug('auth', {
            hasAccessToken: !!accessToken,
            tokenType: accessToken?.tokenType || null,
            hasCookies: cookieString.length > 0
        });

        if (!cookieString && !accessToken) {
            debugInfo.error = 'No valid access token or session cookies found';
            if (debugMode) {
                return {activities: [], debug: debugInfo};
            }
            throw new Error('No valid access token or session cookies found');
        }

        const params = new URLSearchParams({
            start: '0',
            limit: '1000',
            startDate: startDate,
            endDate: endDate
        });

        // Simple params without date filter for testing
        const simpleParams = new URLSearchParams({
            start: '0',
            limit: '20'  // Just get recent 20 activities
        });

        const requests = [];

        if (accessToken) {
            const authHeader = `${accessToken.tokenType} ${accessToken.token}`;
            const authHeaders = {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Authorization': authHeader,
                'NK': 'NT',
                'DI-Backend': 'connectapi.garmin.com',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            };

            requests.push(
                {
                    url: `${GarminPlatform.CONNECT_URL}/activitylist-service/activities/search/activities?${params}`,
                    headers: authHeaders
                },
                {
                    url: `${GarminPlatform.CONNECT_URL}/activitylist-service/activities?${simpleParams}`,
                    headers: authHeaders
                },
                {url: `${GarminPlatform.CONNECT_URL}/activitylist-service/activities?${params}`, headers: authHeaders}
            );

            const connectApiHeaders = {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            };

            requests.push(
                {
                    url: `${GarminPlatform.CONNECT_API_URL}/activitylist-service/activities/search/activities?${params}`,
                    headers: connectApiHeaders
                },
                {
                    url: `${GarminPlatform.CONNECT_API_URL}/activitylist-service/activities?${simpleParams}`,
                    headers: connectApiHeaders
                }
            );
        }

        if (cookieString) {
            const cookieHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookieString,
                'NK': 'NT',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'DI-Backend': 'connectapi.garmin.com',
                'Origin': GarminPlatform.CONNECT_URL,
                'Referer': `${GarminPlatform.MODERN_URL}/`
            };

            requests.push(
                {
                    url: `${GarminPlatform.CONNECT_URL}/proxy/activitylist-service/activities?${simpleParams}`,
                    headers: cookieHeaders
                },
                {
                    url: `${GarminPlatform.CONNECT_URL}/proxy/activitylist-service/activities?${params}`,
                    headers: cookieHeaders
                },
                {
                    url: `${GarminPlatform.CONNECT_URL}/proxy/activitylist-service/activities/search/activities?${params}`,
                    headers: cookieHeaders
                }
            );
        }

        let url;
        let lastError;
        let responseText;
        let responseStatus;
        let responseStatusText;

        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            url = request.url;
            addDebug('trying-endpoint', {url});

            try {
                const fetched = await fetch(url, {headers: request.headers});

                const contentType = fetched.headers.get('content-type') || '';
                if (!fetched.ok) {
                    addDebug('endpoint-failed', {url, status: fetched.status});
                    lastError = `HTTP ${fetched.status}`;
                    continue;
                }

                if (!contentType.includes('application/json')) {
                    addDebug('endpoint-wrong-content', {url, contentType});
                    lastError = `Wrong content type: ${contentType}`;
                    continue;
                }

                const text = await fetched.text();
                const trimmed = text.trim();
                if (trimmed.startsWith('<')) {
                    addDebug('endpoint-html', {url});
                    lastError = 'Received HTML';
                    continue;
                }

                if (trimmed === '{}' && i < requests.length - 1) {
                    addDebug('endpoint-empty-object', {url});
                    lastError = 'Empty JSON object';
                    continue;
                }

                responseText = text;
                responseStatus = fetched.status;
                responseStatusText = fetched.statusText;
                addDebug('endpoint-success', {url, status: fetched.status});
                break;
            } catch (e) {
                addDebug('endpoint-error', {url, error: e.message});
                lastError = e.message;
            }
        }

        if (!responseText) {
            throw new Error(`All API endpoints failed. Last error: ${lastError}`);
        }

        addDebug('request', {url});

        addDebug('response', {status: responseStatus, statusText: responseStatusText});

        addDebug('responseBody', {
            length: responseText.length,
            preview: responseText.substring(0, 500),
            isHTML: responseText.trim().startsWith('<')
        });

        // Check if we got an HTML response (usually means redirect to login)
        if (responseText.trim().startsWith('<')) {
            debugInfo.error = 'Received HTML instead of JSON - session may be invalid';
            debugInfo.htmlPreview = responseText.substring(0, 1000);
            if (debugMode) {
                return {activities: [], debug: debugInfo};
            }
            throw new Error('Session expired - received login page instead of data');
        }

        if (responseStatus && responseStatus >= 400) {
            debugInfo.error = `HTTP ${responseStatus}: ${responseText.substring(0, 500)}`;
            if (debugMode) {
                return {activities: [], debug: debugInfo};
            }
            throw new Error(`Failed to fetch activities: HTTP ${responseStatus}`);
        }

        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            debugInfo.error = `JSON parse error: ${e.message}`;
            if (debugMode) {
                return {activities: [], debug: debugInfo};
            }
            throw new Error('Invalid JSON response from Garmin');
        }

        // Handle different response formats from Garmin API
        let rawActivities;
        let responseFormat = 'unknown';

        if (Array.isArray(responseData)) {
            rawActivities = responseData;
            responseFormat = 'direct_array';
        } else if (responseData && Array.isArray(responseData.activityList)) {
            rawActivities = responseData.activityList;
            responseFormat = 'activityList';
        } else if (responseData && Array.isArray(responseData.activities)) {
            rawActivities = responseData.activities;
            responseFormat = 'activities';
        } else if (responseData && typeof responseData === 'object') {
            const keys = Object.keys(responseData);
            const arrayProp = keys.find(key => Array.isArray(responseData[key]));
            if (arrayProp) {
                rawActivities = responseData[arrayProp];
                responseFormat = `property:${arrayProp}`;
            } else {
                rawActivities = [];
                responseFormat = 'no_array_found';
                debugInfo.responseKeys = keys;
                debugInfo.responsePreview = JSON.stringify(responseData).substring(0, 1000);
            }
        } else {
            rawActivities = [];
            responseFormat = 'invalid';
        }

        addDebug('parsed', {
            responseFormat,
            rawCount: rawActivities.length,
            firstActivity: rawActivities[0] ? JSON.stringify(rawActivities[0]).substring(0, 300) : null
        });

        // Transform to normalized format
        const normalized = this.normalizeActivities(rawActivities);
        addDebug('normalized', {count: normalized.length});

        if (debugMode) {
            return {activities: normalized, debug: debugInfo};
        }

        return normalized;
    }

    /**
     * Build cookie string from stored credentials
     */
    buildCookieString(credentials) {
        const parts = [];
        const addedCookies = new Set();

        if (!credentials) {
            console.error('No credentials provided');
            return '';
        }

        // Helper to add cookie without duplicates
        const addCookie = (name, value) => {
            if (value && !addedCookies.has(name)) {
                parts.push(`${name}=${value}`);
                addedCookies.add(name);
            }
        };

        // Add all cookies from the cookies object FIRST - these have the correct names
        if (credentials.cookies && typeof credentials.cookies === 'object') {
            for (const [name, value] of Object.entries(credentials.cookies)) {
                addCookie(name, value);
            }
        }

        // Add individual credentials if not already added
        // oauth1 is GARMIN-SSO-CUST-GUID
        if (credentials.oauth1 && typeof credentials.oauth1 === 'string' && !addedCookies.has('GARMIN-SSO-CUST-GUID')) {
            addCookie('GARMIN-SSO-CUST-GUID', credentials.oauth1);
        }

        // oauth2 might be SESSION or SESSIONID - try both if not already present
        if (credentials.oauth2 && typeof credentials.oauth2 === 'string') {
            if (!addedCookies.has('SESSION') && !addedCookies.has('SESSIONID')) {
                addCookie('SESSION', credentials.oauth2);
            }
        }

        // JWT tokens
        if (credentials.jwtFgp && !addedCookies.has('JWT_FGP')) {
            addCookie('JWT_FGP', credentials.jwtFgp);
        }
        if (credentials.jwtWeb && !addedCookies.has('JWT_WEB')) {
            addCookie('JWT_WEB', credentials.jwtWeb);
        }

        console.log('Built cookie string with', parts.length, 'cookies:', [...addedCookies].join(', '));
        return parts.join('; ');
    }

    /**
     * Extract OAuth2 access token from credentials
     */
    getOAuthAccessToken(credentials) {
        if (!credentials) return null;

        if (credentials.oauth2AccessToken) {
            if (credentials.oauth2ExpiresAt) {
                const expiresAtMs = typeof credentials.oauth2ExpiresAt === 'number'
                    ? (credentials.oauth2ExpiresAt > 1e12 ? credentials.oauth2ExpiresAt : credentials.oauth2ExpiresAt * 1000)
                    : Date.parse(credentials.oauth2ExpiresAt);
                if (!Number.isNaN(expiresAtMs) && expiresAtMs < Date.now()) {
                    return null;
                }
            }
            return {
                token: credentials.oauth2AccessToken,
                tokenType: credentials.oauth2TokenType || 'Bearer'
            };
        }

        if (credentials.oauth2 && typeof credentials.oauth2 === 'object' && credentials.oauth2.access_token) {
            if (credentials.oauth2.expires_at && credentials.oauth2.expires_at * 1000 < Date.now()) {
                return null;
            }
            return {
                token: credentials.oauth2.access_token,
                tokenType: credentials.oauth2.token_type || 'Bearer'
            };
        }

        return null;
    }

    /**
     * Get authentication headers for API requests
     */
    getAuthHeaders(credentials) {
        const accessToken = this.getOAuthAccessToken(credentials);
        if (accessToken) {
            return {
                'User-Agent': GarminPlatform.MOBILE_USER_AGENT,
                'Authorization': `${accessToken.tokenType} ${accessToken.token}`,
                'NK': 'NT',
                'DI-Backend': 'connectapi.garmin.com',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            };
        }

        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': this.buildCookieString(credentials),
            'NK': 'NT', // Required header for Garmin API
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9'
        };
    }

    /**
     * Normalize Garmin activities to common format
     */
    normalizeActivities(rawActivities) {
        // Ensure we have an array
        if (!Array.isArray(rawActivities)) {
            console.error('normalizeActivities received non-array:', typeof rawActivities);
            return [];
        }

        // First, let's see what activity types we have
        const activityTypes = rawActivities.map(a => {
            return a?.activityType?.typeKey || a?.typeKey || a?.type || 'unknown';
        });
        const uniqueTypes = [...new Set(activityTypes)];
        console.log('Activity types found:', uniqueTypes.join(', '));

        return rawActivities
            .filter(activity => {
                if (!activity) return false;
                const type = activity.activityType?.typeKey?.toLowerCase() ||
                    activity.typeKey?.toLowerCase() ||
                    activity.type?.toLowerCase() || '';
                // Include common activity types
                const included = type.includes('running') ||
                    type.includes('cycling') ||
                    type.includes('strength') ||
                    type.includes('bike') ||
                    type.includes('ride') ||
                    type.includes('walk') ||
                    type.includes('training') ||
                    type.includes('cardio') ||
                    type.includes('fitness') ||
                    type.includes('other');

                if (!included && type) {
                    console.log('Excluding activity type:', type);
                }
                return included || type === ''; // Include if no type specified
            })
            .map(activity => ({
                id: activity.activityId || activity.id,
                platform: 'garmin',
                type: this.mapActivityType(activity.activityType?.typeKey || activity.typeKey || activity.type),
                startTime: activity.startTimeLocal || activity.startTime || activity.startTimeGMT,
                duration: activity.duration || activity.elapsedDuration || activity.movingDuration || 0,
                distance: activity.distance || 0,
                calories: activity.calories || activity.activeKilocalories || 0,
                averageHR: activity.averageHR || activity.avgHr || activity.averageHeartRate,
                maxHR: activity.maxHR || activity.maxHr || activity.maxHeartRate,
                elevationGain: activity.elevationGain || activity.totalAscent,
                elevationLoss: activity.elevationLoss || activity.totalDescent,
                name: activity.activityName || activity.name
            }));
    }

    /**
     * Map Garmin activity type to normalized type
     */
    mapActivityType(garminType) {
        if (!garminType) return 'other';
        const type = garminType.toLowerCase();

        if (type.includes('running') || type.includes('run')) return 'running';
        if (type.includes('cycling') || type.includes('bike') || type.includes('ride')) return 'cycling';
        if (type.includes('strength') || type.includes('weight')) return 'strength';

        return 'other';
    }
}

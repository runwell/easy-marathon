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

    constructor(env) {
        this.env = env;
        this.cookies = new Map();
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
            const sessionToken = btoa(JSON.stringify({
                platform: 'garmin',
                credentials: {
                    oauth1: session.oauth1,
                    oauth2: session.oauth2,
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
        const params = new URLSearchParams({
            service: GarminPlatform.MODERN_URL,
            webhost: GarminPlatform.MODERN_URL,
            source: GarminPlatform.MODERN_URL,
            redirectAfterAccountLoginUrl: GarminPlatform.MODERN_URL,
            redirectAfterAccountCreationUrl: GarminPlatform.MODERN_URL,
            gauthHost: GarminPlatform.SSO_URL,
            locale: 'en_US',
            id: 'gauth-widget',
            cssUrl: 'https://connect.garmin.com/gauth-custom-v1.2-min.css',
            privacyStatementUrl: 'https://www.garmin.com/en-US/privacy/connect/',
            clientId: 'GarminConnect',
            rememberMeShown: 'true',
            rememberMeChecked: 'false',
            createAccountShown: 'true',
            openCreateAccount: 'false',
            displayNameShown: 'false',
            consumeServiceTicket: 'false',
            initialFocus: 'true',
            embedWidget: 'false',
            generateExtraServiceTicket: 'true',
            generateTwoExtraServiceTickets: 'true',
            generateNoServiceTicket: 'false',
            globalOptInShown: 'true',
            globalOptInChecked: 'false',
            mobile: 'false',
            connectLegalTerms: 'true',
            showTermsOfUse: 'false',
            showPrivacyPolicy: 'false',
            showConnectLegalAge: 'false',
            locationPromptShown: 'true',
            showPassword: 'true',
            useCustomHeader: 'false'
        });

        const response = await fetch(`${GarminPlatform.SIGNIN_URL}?${params}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
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
            csrf: csrfToken
        };
    }

    /**
     * Submit login credentials
     */
    async submitLogin(email, password, csrfData) {
        const params = new URLSearchParams({
            service: GarminPlatform.MODERN_URL,
            webhost: GarminPlatform.MODERN_URL,
            source: GarminPlatform.MODERN_URL,
            redirectAfterAccountLoginUrl: GarminPlatform.MODERN_URL,
            redirectAfterAccountCreationUrl: GarminPlatform.MODERN_URL,
            gauthHost: GarminPlatform.SSO_URL,
            locale: 'en_US',
            id: 'gauth-widget',
            cssUrl: 'https://connect.garmin.com/gauth-custom-v1.2-min.css',
            privacyStatementUrl: 'https://www.garmin.com/en-US/privacy/connect/',
            clientId: 'GarminConnect',
            rememberMeShown: 'true',
            rememberMeChecked: 'false',
            createAccountShown: 'true',
            openCreateAccount: 'false',
            displayNameShown: 'false',
            consumeServiceTicket: 'false',
            initialFocus: 'true',
            embedWidget: 'false',
            generateExtraServiceTicket: 'true',
            generateTwoExtraServiceTickets: 'true',
            generateNoServiceTicket: 'false',
            globalOptInShown: 'true',
            globalOptInChecked: 'false',
            mobile: 'false',
            connectLegalTerms: 'true',
            showTermsOfUse: 'false',
            showPrivacyPolicy: 'false',
            showConnectLegalAge: 'false',
            locationPromptShown: 'true',
            showPassword: 'true',
            useCustomHeader: 'false'
        });

        const formData = new URLSearchParams({
            username: email,
            password: password,
            embed: 'false',
            _csrf: csrfData.csrf
        });

        const response = await fetch(`${GarminPlatform.SIGNIN_URL}?${params}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
            const {oauth1, oauth2, cookies} = credentials;
            if (!oauth1 && !oauth2 && !cookies) return false;

            // Try to fetch user profile as validation
            const response = await fetch(
                `${GarminPlatform.CONNECT_URL}/modern/proxy/userprofile-service/socialProfile`,
                {
                    headers: this.getAuthHeaders(credentials)
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
        addDebug('cookies', {
            cookieLength: cookieString.length,
            cookiePreview: cookieString.substring(0, 100) + '...',
            hasCookies: cookieString.length > 0
        });

        if (!cookieString) {
            debugInfo.error = 'No valid session cookies found';
            if (debugMode) {
                return {activities: [], debug: debugInfo};
            }
            throw new Error('No valid session cookies found');
        }

        const params = new URLSearchParams({
            start: '0',
            limit: '1000',
            startDate: startDate,
            endDate: endDate
        });

        // Try the modern proxy endpoint - this is what the Garmin Connect web app uses
        const url = `${GarminPlatform.CONNECT_URL}/modern/proxy/activitylist-service/activities/search/activities?${params}`;
        addDebug('request', {url});

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookieString,
                'NK': 'NT',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'DI-Backend': 'connectapi.garmin.com',
                'Referer': 'https://connect.garmin.com/modern/activities',
                'Origin': 'https://connect.garmin.com'
            }
        });

        addDebug('response', {status: response.status, statusText: response.statusText});

        const responseText = await response.text();
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

        if (!response.ok) {
            debugInfo.error = `HTTP ${response.status}: ${responseText.substring(0, 500)}`;
            if (debugMode) {
                return {activities: [], debug: debugInfo};
            }
            throw new Error(`Failed to fetch activities: HTTP ${response.status}`);
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

        // Add key authentication cookies first (in order of importance)
        addCookie('GARMIN-SSO-CUST-GUID', credentials.oauth1);
        addCookie('SESSIONID', credentials.oauth2);
        addCookie('JWT_FGP', credentials.jwtFgp);
        addCookie('JWT_WEB', credentials.jwtWeb);

        // Add all cookies from the cookies object
        if (credentials.cookies && typeof credentials.cookies === 'object') {
            for (const [name, value] of Object.entries(credentials.cookies)) {
                addCookie(name, value);
            }
        }

        console.log('Built cookie string with', parts.length, 'cookies:', [...addedCookies].join(', '));
        return parts.join('; ');
    }

    /**
     * Get authentication headers for API requests
     */
    getAuthHeaders(credentials) {
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

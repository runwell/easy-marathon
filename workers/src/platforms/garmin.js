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

        try {
            // Step 1: Get CSRF token and cookies from SSO
            console.log('Step 1: Getting CSRF token...');
            const csrfData = await this.getCSRFToken();
            console.log('CSRF token obtained');

            // Step 2: Submit login form
            console.log('Step 2: Submitting login...');
            const loginResult = await this.submitLogin(email, password, csrfData);
            console.log('Login submitted, ticket:', loginResult.ticket ? 'obtained' : 'missing');

            // Step 3: Exchange ticket for session
            console.log('Step 3: Exchanging ticket...');
            const session = await this.exchangeTicket(loginResult.ticket);
            console.log('Session obtained');

            // Create session token (base64 encoded for transport)
            const sessionToken = btoa(JSON.stringify({
                platform: 'garmin',
                credentials: {
                    oauth1: session.oauth1,
                    oauth2: session.oauth2,
                    cookies: session.allCookies
                },
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
            }));

            return {
                token: sessionToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                displayName: session.displayName || email.split('@')[0]
            };

        } catch (error) {
            console.error('Garmin authentication error:', error.message, error.stack);
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

        // Parse and store cookies
        for (const cookie of cookies) {
            const match = cookie.match(/^([^=]+)=([^;]*)/);
            if (match) {
                this.cookies.set(match[1], match[2]);
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

        // Parse cookies from response
        this.parseSetCookies(response);

        // Follow redirects manually to collect all cookies
        let redirectUrl = response.headers.get('location');
        let maxRedirects = 5;

        while (redirectUrl && maxRedirects > 0) {
            console.log('Following redirect to:', redirectUrl);

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

            this.parseSetCookies(redirectResponse);
            redirectUrl = redirectResponse.headers.get('location');
            maxRedirects--;
        }

        // Get OAuth tokens from cookies
        const oauth1 = this.cookies.get('GARMIN-SSO-CUST-GUID');
        const oauth2 = this.cookies.get('SESSIONID');

        // Collect all relevant cookies for future API calls
        const allCookies = {};
        for (const [name, value] of this.cookies) {
            if (name.includes('GARMIN') || name === 'SESSIONID' || name === 'JWT_FGP' || name === '__cflb') {
                allCookies[name] = value;
            }
        }

        console.log('Cookies collected:', Object.keys(allCookies).join(', '));

        if (!oauth1 && !oauth2 && Object.keys(allCookies).length === 0) {
            throw new Error('Failed to obtain session cookies');
        }

        return {
            oauth1,
            oauth2,
            allCookies,
            displayName: null // Could be extracted from profile call
        };
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
    async fetchActivities(credentials, startDate, endDate) {
        const params = new URLSearchParams({
            start: '0',
            limit: '1000',
            startDate: startDate,
            endDate: endDate
        });

        const response = await fetch(
            `${GarminPlatform.CONNECT_URL}/proxy/activitylist-service/activities/search/activities?${params}`,
            {
                headers: this.getAuthHeaders(credentials)
            }
        );

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error('Activities fetch failed:', response.status, errorText.substring(0, 500));
            throw new Error(`Failed to fetch activities: HTTP ${response.status}`);
        }

        const rawActivities = await response.json();

        // Transform to normalized format
        return this.normalizeActivities(rawActivities);
    }

    /**
     * Get authentication headers for API requests
     */
    getAuthHeaders(credentials) {
        const {oauth1, oauth2, cookies} = credentials;
        const cookieParts = [];

        // Add individual OAuth cookies
        if (oauth1) cookieParts.push(`GARMIN-SSO-CUST-GUID=${oauth1}`);
        if (oauth2) cookieParts.push(`SESSIONID=${oauth2}`);

        // Add all stored cookies
        if (cookies && typeof cookies === 'object') {
            for (const [name, value] of Object.entries(cookies)) {
                // Don't duplicate cookies we already added
                if (name !== 'GARMIN-SSO-CUST-GUID' && name !== 'SESSIONID') {
                    cookieParts.push(`${name}=${value}`);
                }
            }
        }

        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': cookieParts.join('; '),
            'NK': 'NT', // Required header for Garmin API
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9'
        };
    }

    /**
     * Normalize Garmin activities to common format
     */
    normalizeActivities(rawActivities) {
        return rawActivities
            .filter(activity => {
                const type = activity.activityType?.typeKey?.toLowerCase() || '';
                return type.includes('running') ||
                    type.includes('cycling') ||
                    type.includes('strength') ||
                    type.includes('bike') ||
                    type.includes('ride');
            })
            .map(activity => ({
                id: activity.activityId,
                platform: 'garmin',
                type: this.mapActivityType(activity.activityType?.typeKey),
                startTime: activity.startTimeLocal,
                duration: activity.duration || 0,
                distance: activity.distance || 0,
                calories: activity.calories || 0,
                averageHR: activity.averageHR,
                maxHR: activity.maxHR,
                elevationGain: activity.elevationGain,
                elevationLoss: activity.elevationLoss,
                name: activity.activityName
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

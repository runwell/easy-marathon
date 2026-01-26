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
        console.log('Fetching activities with credentials keys:', Object.keys(credentials || {}));
        console.log('Date range:', startDate, 'to', endDate);

        // Build cookie string from credentials
        const cookieString = this.buildCookieString(credentials);
        console.log('Cookie string length:', cookieString.length);

        if (!cookieString) {
            throw new Error('No valid session cookies found');
        }

        const params = new URLSearchParams({
            start: '0',
            limit: '1000',
            startDate: startDate,
            endDate: endDate
        });

        const url = `${GarminPlatform.CONNECT_URL}/proxy/activitylist-service/activities/search/activities?${params}`;
        console.log('Fetching from URL:', url);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookieString,
                'NK': 'NT',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error('Activities fetch failed:', response.status, errorText.substring(0, 1000));
            throw new Error(`Failed to fetch activities: HTTP ${response.status}`);
        }

        const responseText = await response.text();
        console.log('Response length:', responseText.length);
        console.log('Response preview:', responseText.substring(0, 500));

        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            console.error('Failed to parse JSON:', e.message);
            throw new Error('Invalid JSON response from Garmin');
        }

        // Handle different response formats from Garmin API
        let rawActivities;
        if (Array.isArray(responseData)) {
            // Direct array response
            rawActivities = responseData;
            console.log('Response is direct array');
        } else if (responseData && Array.isArray(responseData.activityList)) {
            // Wrapped in activityList property
            rawActivities = responseData.activityList;
            console.log('Found activities in activityList');
        } else if (responseData && Array.isArray(responseData.activities)) {
            // Wrapped in activities property
            rawActivities = responseData.activities;
            console.log('Found activities in activities');
        } else if (responseData && typeof responseData === 'object') {
            // Try to find any array property
            console.log('Response keys:', Object.keys(responseData));
            const arrayProp = Object.keys(responseData).find(key => Array.isArray(responseData[key]));
            if (arrayProp) {
                console.log('Found activities in property:', arrayProp);
                rawActivities = responseData[arrayProp];
            } else {
                console.error('Unexpected response structure:', JSON.stringify(responseData).substring(0, 1000));
                rawActivities = [];
            }
        } else {
            console.error('Unexpected response type:', typeof responseData);
            rawActivities = [];
        }

        console.log(`Fetched ${rawActivities.length} raw activities`);

        // Log first activity for debugging
        if (rawActivities.length > 0) {
            console.log('First activity sample:', JSON.stringify(rawActivities[0]).substring(0, 500));
        }

        // Transform to normalized format
        const normalized = this.normalizeActivities(rawActivities);
        console.log(`Normalized to ${normalized.length} activities`);

        return normalized;
    }

    /**
     * Build cookie string from stored credentials
     */
    buildCookieString(credentials) {
        const parts = [];

        if (!credentials) {
            console.error('No credentials provided');
            return '';
        }

        // Add oauth1 and oauth2 if present
        if (credentials.oauth1) {
            parts.push(`GARMIN-SSO-CUST-GUID=${credentials.oauth1}`);
        }
        if (credentials.oauth2) {
            parts.push(`SESSIONID=${credentials.oauth2}`);
        }

        // Add all cookies from the cookies object
        if (credentials.cookies && typeof credentials.cookies === 'object') {
            for (const [name, value] of Object.entries(credentials.cookies)) {
                if (name !== 'GARMIN-SSO-CUST-GUID' && name !== 'SESSIONID' && value) {
                    parts.push(`${name}=${value}`);
                }
            }
        }

        console.log('Built cookie parts:', parts.length);
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

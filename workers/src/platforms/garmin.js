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
    static CONNECT_URL = 'https://connect.garmin.com';
    static MODERN_URL = 'https://connect.garmin.com/modern';

    constructor(env) {
        this.env = env;
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
            const csrfData = await this.getCSRFToken();

            // Step 2: Submit login form
            const loginResult = await this.submitLogin(email, password, csrfData);

            // Step 3: Exchange ticket for session
            const session = await this.exchangeTicket(loginResult.ticket, csrfData.cookies);

            // Create session token (base64 encoded for transport)
            const sessionToken = btoa(JSON.stringify({
                platform: 'garmin',
                credentials: {
                    oauth1: session.oauth1,
                    oauth2: session.oauth2
                },
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
            }));

            return {
                token: sessionToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                displayName: session.displayName || email.split('@')[0]
            };

        } catch (error) {
            console.error('Garmin authentication error:', error);
            throw new Error('Authentication failed. Please check your credentials.');
        }
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

        const response = await fetch(`${GarminPlatform.SSO_URL}/signin?${params}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EasyMarathon/1.0)',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to get CSRF token');
        }

        const html = await response.text();
        const cookies = response.headers.get('set-cookie') || '';

        // Extract CSRF token from HTML
        const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
        if (!csrfMatch) {
            throw new Error('CSRF token not found');
        }

        return {
            csrf: csrfMatch[1],
            cookies: cookies
        };
    }

    /**
     * Submit login credentials
     */
    async submitLogin(email, password, csrfData) {
        const formData = new URLSearchParams({
            username: email,
            password: password,
            embed: 'false',
            _csrf: csrfData.csrf
        });

        const response = await fetch(`${GarminPlatform.SSO_URL}/signin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (compatible; EasyMarathon/1.0)',
                'Cookie': csrfData.cookies,
                'Origin': GarminPlatform.SSO_URL,
                'Referer': `${GarminPlatform.SSO_URL}/signin`
            },
            body: formData.toString(),
            redirect: 'manual'
        });

        // Check for redirect (successful login)
        const location = response.headers.get('location') || '';
        const responseText = await response.text();

        // Extract ticket from response
        const ticketMatch = responseText.match(/ticket=([^"&]+)/) ||
            location.match(/ticket=([^"&]+)/);

        if (!ticketMatch) {
            // Check for error message
            if (responseText.includes('Invalid') || responseText.includes('incorrect')) {
                throw new Error('Invalid email or password');
            }
            throw new Error('Login failed - no ticket received');
        }

        return {
            ticket: ticketMatch[1],
            cookies: response.headers.get('set-cookie') || csrfData.cookies
        };
    }

    /**
     * Exchange ticket for OAuth tokens
     */
    async exchangeTicket(ticket, cookies) {
        // Exchange ticket for session
        const response = await fetch(
            `${GarminPlatform.MODERN_URL}/?ticket=${ticket}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; EasyMarathon/1.0)',
                    'Cookie': cookies
                },
                redirect: 'manual'
            }
        );

        const sessionCookies = response.headers.get('set-cookie') || '';

        // For simplified implementation, we'll store the essential cookies
        // that allow API access
        return {
            oauth1: this.extractCookieValue(sessionCookies, 'GARMIN-SSO-CUST-GUID'),
            oauth2: this.extractCookieValue(sessionCookies, 'SESSIONID'),
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
            const {oauth1, oauth2} = credentials;
            if (!oauth1 && !oauth2) return false;

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
        const {oauth1, oauth2} = credentials;

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
            throw new Error('Failed to fetch activities');
        }

        const rawActivities = await response.json();

        // Transform to normalized format
        return this.normalizeActivities(rawActivities);
    }

    /**
     * Get authentication headers for API requests
     */
    getAuthHeaders(credentials) {
        const {oauth1, oauth2} = credentials;
        const cookies = [];
        if (oauth1) cookies.push(`GARMIN-SSO-CUST-GUID=${oauth1}`);
        if (oauth2) cookies.push(`SESSIONID=${oauth2}`);

        return {
            'User-Agent': 'Mozilla/5.0 (compatible; EasyMarathon/1.0)',
            'Cookie': cookies.join('; '),
            'NK': 'NT', // Required header for Garmin API
            'Accept': 'application/json'
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

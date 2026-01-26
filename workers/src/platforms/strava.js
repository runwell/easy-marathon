/**
 * Strava Platform Integration (Placeholder)
 *
 * Strava supports OAuth 2.0, which is the recommended authentication method.
 * This is a placeholder for future implementation.
 *
 * 1. Register app at https://developers.strava.com
 * 2. Get Client ID and Client Secret
 * 3. Implement OAuth flow
 */

export class StravaPlatform {
    static NAME = 'Strava';
    static SUPPORTED = false; // Not yet implemented
    static HAS_OAUTH = true;

    // Strava API endpoints
    static AUTH_URL = 'https://www.strava.com/oauth/authorize';
    static TOKEN_URL = 'https://www.strava.com/oauth/token';
    static API_URL = 'https://www.strava.com/api/v3';

    constructor(env) {
        this.env = env;
        this.clientId = env.STRAVA_CLIENT_ID;
        this.clientSecret = env.STRAVA_CLIENT_SECRET;
    }

    /**
     * Get OAuth authorization URL
     * Frontend should redirect user to this URL
     */
    getAuthorizationUrl(redirectUri) {
        const params = new URLSearchParams({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: 'read,activity:read',
            approval_prompt: 'force'
        });

        return `${StravaPlatform.AUTH_URL}?${params}`;
    }

    /**
     * Authenticate using OAuth code
     * @param {Object} credentials - { code, redirectUri }
     * @returns {Object} Session data
     */
    async authenticate(credentials) {
        throw new Error('Strava integration is not yet implemented. Coming soon!');

        // Future implementation:
        // const { code, redirectUri } = credentials;
        //
        // const response = await fetch(StravaPlatform.TOKEN_URL, {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({
        //     client_id: this.clientId,
        //     client_secret: this.clientSecret,
        //     code: code,
        //     grant_type: 'authorization_code'
        //   })
        // });
        //
        // const data = await response.json();
        // return {
        //   token: data.access_token,
        //   refreshToken: data.refresh_token,
        //   expiresAt: new Date(data.expires_at * 1000).toISOString(),
        //   displayName: data.athlete.firstname
        // };
    }

    /**
     * Validate an existing session
     */
    async validateSession(credentials) {
        return false; // Not implemented
    }

    /**
     * Fetch activities from Strava
     */
    async fetchActivities(credentials, startDate, endDate) {
        throw new Error('Strava integration is not yet implemented');

        // Future implementation:
        // const response = await fetch(
        //   `${StravaPlatform.API_URL}/athlete/activities?after=${startTimestamp}&before=${endTimestamp}`,
        //   {
        //     headers: { 'Authorization': `Bearer ${credentials.accessToken}` }
        //   }
        // );
        // return this.normalizeActivities(await response.json());
    }

    /**
     * Normalize Strava activities to common format
     */
    normalizeActivities(rawActivities) {
        return rawActivities.map(activity => ({
            id: activity.id,
            platform: 'strava',
            type: this.mapActivityType(activity.type),
            startTime: activity.start_date_local,
            duration: activity.elapsed_time,
            distance: activity.distance,
            calories: activity.calories || 0,
            averageHR: activity.average_heartrate,
            maxHR: activity.max_heartrate,
            elevationGain: activity.total_elevation_gain,
            name: activity.name
        }));
    }

    /**
     * Map Strava activity type to normalized type
     */
    mapActivityType(stravaType) {
        const typeMap = {
            'Run': 'running',
            'Ride': 'cycling',
            'VirtualRide': 'cycling',
            'WeightTraining': 'strength'
        };
        return typeMap[stravaType] || 'other';
    }
}

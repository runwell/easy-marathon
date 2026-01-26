/**
 * Easy Marathon API - Cloudflare Workers
 *
 * Handles authentication and activity fetching for multiple fitness platforms.
 * Currently supports: Garmin Connect
 * Future support planned for: Strava, Coros
 */

import {GarminPlatform} from './platforms/garmin.js';
import {StravaPlatform} from './platforms/strava.js';
import {CorosPlatform} from './platforms/coros.js';

// Platform registry
const PLATFORMS = {
    garmin: GarminPlatform,
    strava: StravaPlatform,
    coros: CorosPlatform
};

// CORS headers
function corsHeaders(env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
    };
}

// JSON response helper
function jsonResponse(data, status = 200, env = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(env)
        }
    });
}

// Error response helper
function errorResponse(message, status = 400, env = {}) {
    return jsonResponse({error: message}, status, env);
}

// Main request handler
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(env)
            });
        }

        try {
            // Route handling
            if (path === '/api/health') {
                return jsonResponse({status: 'ok', timestamp: new Date().toISOString()}, 200, env);
            }

            if (path === '/api/platforms') {
                return handleGetPlatforms(env);
            }

            if (path === '/api/auth/login') {
                return handleLogin(request, env);
            }

            if (path === '/api/auth/logout') {
                return handleLogout(request, env);
            }

            if (path === '/api/auth/validate') {
                return handleValidateSession(request, env);
            }

            if (path === '/api/activities') {
                return handleGetActivities(request, env);
            }

            return errorResponse('Not found', 404, env);

        } catch (error) {
            console.error('Request error:', error);
            return errorResponse('Internal server error', 500, env);
        }
    }
};

/**
 * Get available platforms and their status
 */
function handleGetPlatforms(env) {
    const platforms = Object.entries(PLATFORMS).map(([id, Platform]) => ({
        id,
        name: Platform.NAME,
        supported: Platform.SUPPORTED,
        hasOAuth: Platform.HAS_OAUTH
    }));

    return jsonResponse({platforms}, 200, env);
}

/**
 * Handle user login for a specific platform
 */
async function handleLogin(request, env) {
    if (request.method !== 'POST') {
        return errorResponse('Method not allowed', 405, env);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('Invalid JSON body', 400, env);
    }

    const {platform, credentials} = body;

    if (!platform || !credentials) {
        return errorResponse('Missing platform or credentials', 400, env);
    }

    const PlatformClass = PLATFORMS[platform];
    if (!PlatformClass) {
        return errorResponse(`Unknown platform: ${platform}`, 400, env);
    }

    if (!PlatformClass.SUPPORTED) {
        return errorResponse(`Platform ${platform} is not yet supported`, 400, env);
    }

    try {
        const platformInstance = new PlatformClass(env);
        const session = await platformInstance.authenticate(credentials);

        return jsonResponse({
            success: true,
            session: {
                token: session.token,
                platform: platform,
                expiresAt: session.expiresAt,
                displayName: session.displayName
            }
        }, 200, env);

    } catch (error) {
        console.error(`Login error for ${platform}:`, error);
        return errorResponse(error.message || 'Authentication failed', 401, env);
    }
}

/**
 * Handle user logout
 */
async function handleLogout(request, env) {
    if (request.method !== 'POST') {
        return errorResponse('Method not allowed', 405, env);
    }

    // For now, logout is handled client-side by clearing localStorage
    // In the future, we could invalidate server-side sessions here

    return jsonResponse({success: true}, 200, env);
}

/**
 * Validate an existing session
 */
async function handleValidateSession(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return errorResponse('Missing or invalid authorization header', 401, env);
    }

    const token = authHeader.substring(7);

    try {
        const sessionData = JSON.parse(atob(token));
        const {platform, credentials, expiresAt} = sessionData;

        // Check expiration
        if (expiresAt && new Date(expiresAt) < new Date()) {
            return errorResponse('Session expired', 401, env);
        }

        const PlatformClass = PLATFORMS[platform];
        if (!PlatformClass) {
            return errorResponse('Invalid platform in session', 401, env);
        }

        const platformInstance = new PlatformClass(env);
        const isValid = await platformInstance.validateSession(credentials);

        if (!isValid) {
            return errorResponse('Session invalid', 401, env);
        }

        return jsonResponse({valid: true, platform}, 200, env);

    } catch (error) {
        console.error('Session validation error:', error);
        return errorResponse('Invalid session token', 401, env);
    }
}

/**
 * Get activities for authenticated user
 */
async function handleGetActivities(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return errorResponse('Missing or invalid authorization header', 401, env);
    }

    const token = authHeader.substring(7);
    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate') || getDefaultStartDate();
    const endDate = url.searchParams.get('endDate') || new Date().toISOString().split('T')[0];

    try {
        const sessionData = JSON.parse(atob(token));
        const {platform, credentials} = sessionData;

        const PlatformClass = PLATFORMS[platform];
        if (!PlatformClass) {
            return errorResponse('Invalid platform in session', 401, env);
        }

        const platformInstance = new PlatformClass(env);
        const activities = await platformInstance.fetchActivities(credentials, startDate, endDate);

        return jsonResponse({activities, startDate, endDate}, 200, env);

    } catch (error) {
        console.error('Activities fetch error:', error);
        return errorResponse(error.message || 'Failed to fetch activities', 500, env);
    }
}

/**
 * Get default start date (beginning of current year)
 */
function getDefaultStartDate() {
    const now = new Date();
    return `${now.getFullYear()}-01-01`;
}

/**
 * Marathon Training Log Visualization
 * With Authentication Support
 */

import {AuthService, LoginModal, UserMenu} from './auth.js';

// Configuration
const ACTIVITY_TYPES = {
    RUN: ['running', 'treadmill_running'],
    RIDE: ['cycling', 'indoor_cycling', 'ride'],
    STRENGTH: ['weight_training', 'strength_training']
};

const DOT_COLORS = {
    RUN: '#22c55e',
    RIDE: '#3b82f6',
    STRENGTH: '#9ca3af'
};

const RACES = {
    '2025-05-04': 'Flying Pig',
    '2025-05-18': 'Brooklyn Half',
    '2025-10-12': 'Chicago',
    '2025-11-08': 'Monumental',
    '2026-04-18': 'Carmel',
    '2026-04-20': 'Boston',
    '2026-04-25': 'KDF',
    '2026-05-31': 'RnR SD',
    '2026-10-11': 'Chicago',
    '2026-11-01': 'NYC'
};

const MIN_DOT_PX = 30;
const MAX_DOT_PX = 80;

// State
let rawActivities = [];
let dailySummaries = {};
let globalMax = {duration: 0};
let currentYear = new Date().getFullYear();
let availableYears = new Set();

// DOM Elements
const visualizationContainer = document.getElementById('visualizationContainer');
const userMenuContainer = document.getElementById('user-menu-container');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    loadData();
});

// Listen for auth events
window.addEventListener('auth:login', () => {
    initializeUI();
    loadDataFromAPI();
});

window.addEventListener('auth:logout', () => {
    initializeUI();
    showLoginPrompt();
});

/**
 * Initialize the UI (user menu, etc.)
 */
function initializeUI() {
    // Render user menu
    if (userMenuContainer) {
        userMenuContainer.innerHTML = '';
        const menu = UserMenu.create();
        userMenuContainer.appendChild(menu);
        UserMenu.setup();
    }
}

/**
 * Load data - either from API if logged in, or show login prompt
 */
async function loadData() {
    if (AuthService.isLoggedIn()) {
        await loadDataFromAPI();
    } else {
        showLoginPrompt();
    }
}

/**
 * Load activities from API
 */
async function loadDataFromAPI() {
    visualizationContainer.innerHTML = `
        <div style="padding: 60px; text-align: center; color: var(--text-secondary);">
            <div class="loading-spinner"></div>
            <p style="margin-top: 16px;">Loading your activities...</p>
        </div>
    `;

    try {
        // Fetch all activities from January 1, 2025 to end of current year
        const startDate = '2025-01-01';
        const endDate = `${new Date().getFullYear()}-12-31`;

        // Use debug mode to get raw response
        const result = await fetchActivitiesWithDebug(startDate, endDate);

        // Show status message with activity count and debug info
        showActivityStatus(result.activities.length, startDate, endDate, result.debug);

        processAPIData(result.activities);

    } catch (error) {
        console.error('Failed to load activities:', error);

        if (error.message.includes('Session expired') || error.message.includes('Not logged in')) {
            showLoginPrompt();
        } else {
            visualizationContainer.innerHTML = `
                <div style="padding: 60px; text-align: center; color: var(--text-secondary);">
                    <p style="color: #f87171; margin-bottom: 16px;">Failed to load activities</p>
                    <p style="font-size: 14px; margin-bottom: 20px;">${error.message}</p>
                    <button class="login-prompt-btn" onclick="window.location.reload()">Retry</button>
                </div>
            `;
        }
    }
}

/**
 * Fetch activities with debug information
 */
async function fetchActivitiesWithDebug(startDate, endDate) {
    const session = AuthService.getSession();
    if (!session?.token) {
        throw new Error('Not logged in');
    }

    const params = new URLSearchParams();
    params.set('startDate', startDate);
    params.set('endDate', endDate);
    params.set('debug', 'true');  // Enable debug mode

    const apiUrl = AuthService.getApiUrl();
    const url = `${apiUrl}/api/activities?${params}`;

    console.log('Fetching from:', url);

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${session.token}`
        }
    });

    const responseText = await response.text();
    console.log('Raw API response:', responseText.substring(0, 2000));

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }

    if (!response.ok) {
        if (response.status === 401) {
            AuthService.logout();
            throw new Error('Session expired. Please login again.');
        }
        throw new Error(data.error || `API error: ${response.status}`);
    }

    // Build debug info from response
    const debug = {
        apiUrl: url,
        status: response.status,
        rawLength: responseText.length,
        activityCount: data.activities?.length || 0,
        sampleActivity: data.activities?.[0] ? JSON.stringify(data.activities[0]).substring(0, 300) : 'none',
        // Include server-side debug info if available
        serverDebug: data.debug || null
    };

    return {
        activities: data.activities || [],
        debug
    };
}

/**
 * Show status message with activity count
 */
function showActivityStatus(count, startDate, endDate, debug = null) {
    // Remove existing status if any
    const existingStatus = document.getElementById('activity-status');
    if (existingStatus) existingStatus.remove();

    const platform = AuthService.getPlatform() || 'API';
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

    const statusDiv = document.createElement('div');
    statusDiv.id = 'activity-status';
    statusDiv.className = 'activity-status';

    let debugHtml = '';
    if (debug) {
        let serverDebugHtml = '';
        if (debug.serverDebug) {
            const sd = debug.serverDebug;
            serverDebugHtml = `
                <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
                <p><strong>Server Debug Info:</strong></p>
                <p><strong>Credential Keys:</strong> ${sd.credentialKeys?.join(', ') || 'none'}</p>
                ${sd.error ? `<p style="color: #f87171;"><strong>Error:</strong> ${sd.error}</p>` : ''}
                ${sd.htmlPreview ? `<p><strong>HTML Response (session expired?):</strong></p><pre>${escapeHtml(sd.htmlPreview)}</pre>` : ''}
                <p><strong>Activity Fetch Steps:</strong></p>
                <pre>${JSON.stringify(sd.steps, null, 2)}</pre>
                ${sd.authDebug ? `
                    <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
                    <p><strong>Login/Auth Debug (from when you signed in):</strong></p>
                    <pre>${JSON.stringify(sd.authDebug, null, 2)}</pre>
                ` : ''}
            `;
        }

        debugHtml = `
            <button class="debug-toggle-btn" onclick="toggleDebugInfo()">Show Debug Info</button>
            <div id="debug-info" class="debug-info" style="display: none;">
                <p><strong>API URL:</strong> ${debug.apiUrl}</p>
                <p><strong>Status:</strong> ${debug.status}</p>
                <p><strong>Response size:</strong> ${debug.rawLength} bytes</p>
                <p><strong>Activities in response:</strong> ${debug.activityCount}</p>
                <p><strong>Sample activity:</strong></p>
                <pre>${debug.sampleActivity}</pre>
                ${serverDebugHtml}
            </div>
        `;
    }

    statusDiv.innerHTML = `
        <div class="status-main">
            <span class="status-icon">${count > 0 ? '✓' : '⚠'}</span>
            Loaded <strong>${count}</strong> activities from ${platformName} 
            <span class="status-date">(${startDate} to ${endDate})</span>
            ${debugHtml}
        </div>
    `;

    // Insert after header
    const header = document.querySelector('header');
    if (header && header.nextSibling) {
        header.parentNode.insertBefore(statusDiv, header.nextSibling);
    }
}

/**
 * Toggle debug info visibility
 */
window.toggleDebugInfo = function () {
    const debugInfo = document.getElementById('debug-info');
    const btn = document.querySelector('.debug-toggle-btn');
    if (debugInfo) {
        if (debugInfo.style.display === 'none') {
            debugInfo.style.display = 'block';
            btn.textContent = 'Hide Debug Info';
        } else {
            debugInfo.style.display = 'none';
            btn.textContent = 'Show Debug Info';
        }
    }
};

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show login prompt for unauthenticated users
 */
function showLoginPrompt() {
    visualizationContainer.innerHTML = `
        <div class="login-prompt">
            <div class="login-prompt-icon">📊</div>
            <h2>Connect Your Fitness Account</h2>
            <p>Sign in to sync your training activities from Garmin, Strava, or Coros.</p>
            <button class="login-prompt-btn" id="show-login-btn">
                <span>Get Started</span>
            </button>
        </div>
    `;

    document.getElementById('show-login-btn')?.addEventListener('click', () => {
        LoginModal.show();
    });
}

/**
 * Process activities from API
 */
function processAPIData(activities) {
    rawActivities = [];
    dailySummaries = {};
    globalMax = {duration: 0};
    availableYears = new Set();
    availableYears.add(currentYear);

    activities.forEach(activity => {
        const type = activity.type?.toLowerCase() || '';
        let category = null;

        if (type.includes('running') || type === 'running') category = 'RUN';
        else if (type.includes('cycling') || type === 'cycling') category = 'RIDE';
        else if (type.includes('strength') || type === 'strength') category = 'STRENGTH';

        if (!category) return;

        // Parse date
        const startTime = activity.startTime || '';
        const rawDatePart = startTime.substring(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDatePart)) return;

        const dateObj = parseLocal(rawDatePart);
        availableYears.add(dateObj.getFullYear());

        if (isNaN(dateObj.getTime())) return;

        const date = formatLocal(dateObj);

        if (!dailySummaries[date]) {
            dailySummaries[date] = {
                date: date,
                runDistance: 0,
                runDuration: 0,
                rideDuration: 0,
                rideDistance: 0,
                strengthDuration: 0,
                activities: []
            };
        }

        const activityData = {
            startTime: startTime,
            type: type,
            distance: activity.distance || 0,
            duration: activity.duration || 0
        };

        dailySummaries[date].activities.push(activityData);

        if (category === 'RUN') {
            dailySummaries[date].runDistance += activityData.distance;
            dailySummaries[date].runDuration += activityData.duration;
        } else if (category === 'RIDE') {
            dailySummaries[date].rideDuration += activityData.duration;
            dailySummaries[date].rideDistance += activityData.distance;
        } else if (category === 'STRENGTH') {
            dailySummaries[date].strengthDuration += activityData.duration;
        }
    });

    // Calculate max values
    Object.values(dailySummaries).forEach(day => {
        if (day.runDuration > globalMax.duration) globalMax.duration = day.runDuration;
        if (day.rideDuration > globalMax.duration) globalMax.duration = day.rideDuration;
        if (day.strengthDuration > globalMax.duration) globalMax.duration = day.strengthDuration;
    });

    updateYearControls();
    renderVisualization();
}

/**
 * Process CSV data (for demo/fallback)
 */
function processCSVData(csvText) {
    const lines = csvText.split('\n');
    if (lines.length < 2) return;

    const headers = parseCSVLine(lines[0]);
    const headerMap = {};
    headers.forEach((h, i) => headerMap[h.trim()] = i);

    if (!('start_time' in headerMap && 'activity_type' in headerMap)) {
        alert('Invalid CSV format. Missing start_time or activity_type.');
        return;
    }

    rawActivities = [];
    dailySummaries = {};
    globalMax = {duration: 0};
    availableYears = new Set();
    availableYears.add(currentYear);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const row = parseCSVLine(line);
        if (row.length !== headers.length) continue;

        const activity = {
            startTime: row[headerMap['start_time']].trim(),
            type: row[headerMap['activity_type']].trim(),
            distance: parseFloat(row[headerMap['distance_meters']] || 0),
            duration: parseFloat(row[headerMap['duration_seconds']] || 0)
        };

        if (isNaN(activity.distance)) activity.distance = 0;
        if (isNaN(activity.duration)) activity.duration = 0;

        let category = null;
        if (ACTIVITY_TYPES.RUN.includes(activity.type)) category = 'RUN';
        else if (ACTIVITY_TYPES.RIDE.includes(activity.type)) category = 'RIDE';
        else if (ACTIVITY_TYPES.STRENGTH.includes(activity.type)) category = 'STRENGTH';

        if (category) {
            const rawDatePart = activity.startTime.substring(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDatePart)) continue;

            const dateObj = parseLocal(rawDatePart);
            availableYears.add(dateObj.getFullYear());

            if (isNaN(dateObj.getTime())) continue;

            const date = formatLocal(dateObj);

            if (!dailySummaries[date]) {
                dailySummaries[date] = {
                    date: date,
                    runDistance: 0,
                    runDuration: 0,
                    rideDuration: 0,
                    rideDistance: 0,
                    strengthDuration: 0,
                    activities: []
                };
            }

            dailySummaries[date].activities.push(activity);

            if (category === 'RUN') {
                dailySummaries[date].runDistance += activity.distance;
                dailySummaries[date].runDuration += activity.duration;
            } else if (category === 'RIDE') {
                dailySummaries[date].rideDuration += activity.duration;
                dailySummaries[date].rideDistance += activity.distance;
            } else if (category === 'STRENGTH') {
                dailySummaries[date].strengthDuration += activity.duration;
            }
        }
    }

    Object.values(dailySummaries).forEach(day => {
        if (day.runDuration > globalMax.duration) globalMax.duration = day.runDuration;
        if (day.rideDuration > globalMax.duration) globalMax.duration = day.rideDuration;
        if (day.strengthDuration > globalMax.duration) globalMax.duration = day.strengthDuration;
    });

    updateYearControls();
    renderVisualization();
}

function parseCSVLine(text) {
    const re_value = /(?!\s*$)\s*(?:'([^']*)'|"([^"]*)"|([^,'"]*))\s*(?:,|$)/g;
    const a = [];
    text.replace(re_value, function (m0, m1, m2, m3) {
        if (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"));
        else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"'));
        else if (m3 !== undefined) a.push(m3);
        return '';
    });
    if (/,\s*$/.test(text)) a.push('');
    return a;
}

function parseLocal(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function formatLocal(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function renderVisualization() {
    visualizationContainer.innerHTML = '';

    const startDate = new Date(currentYear, 0, 1);
    const endDate = new Date(currentYear, 11, 31);

    const gridStart = new Date(startDate);
    const dayOfWeek = gridStart.getDay();
    const diff = gridStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    gridStart.setDate(diff);

    const gridEnd = new Date(endDate);
    const endDayOfWeek = gridEnd.getDay();
    const endDiff = gridEnd.getDate() + (endDayOfWeek === 0 ? 0 : 7 - endDayOfWeek);
    gridEnd.setDate(endDiff);

    let current = new Date(gridStart);
    let weekRow = document.createElement('div');
    weekRow.className = 'week-row';

    // Header Row
    const headerRow = document.createElement('div');
    headerRow.className = 'week-row week-header';
    headerRow.style.marginBottom = '8px';
    headerRow.style.color = '#999';
    headerRow.style.fontWeight = '500';
    headerRow.style.fontSize = '12px';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Weekly Summary'].forEach(d => {
        const cell = document.createElement('div');
        cell.style.textAlign = 'center';
        cell.textContent = d;
        headerRow.appendChild(cell);
    });
    visualizationContainer.appendChild(headerRow);

    let weeklyStats = {
        runDistance: 0,
        runDuration: 0,
        rideDuration: 0,
        rideDistance: 0,
        strengthDuration: 0
    };

    while (current <= gridEnd) {
        const dateStr = formatLocal(current);
        const dayData = dailySummaries[dateStr];

        const cell = document.createElement('div');
        cell.className = 'day-cell';

        const dateLabel = document.createElement('span');
        dateLabel.className = 'day-date';
        dateLabel.textContent = `${current.getMonth() + 1}/${current.getDate()}`;
        if (current < startDate || current > endDate) {
            cell.classList.add('other-month');
        }

        if (RACES[dateStr]) {
            cell.classList.add('race-day');
            dateLabel.innerHTML = `${current.getMonth() + 1}/${current.getDate()} <span class="race-name">${RACES[dateStr]}</span>`;
        }

        cell.appendChild(dateLabel);

        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'activities-container';

        if (dayData) {
            if (dayData.runDistance > 0) {
                const size = calculateSize(dayData.runDuration, globalMax.duration);
                dotsContainer.appendChild(createDot('RUN', size, dayData.runDistance));
                weeklyStats.runDistance += dayData.runDistance;
                weeklyStats.runDuration += dayData.runDuration;
            }
            if (dayData.rideDuration > 0) {
                const size = calculateSize(dayData.rideDuration, globalMax.duration);
                dotsContainer.appendChild(createDot('RIDE', size, dayData.rideDuration));
                weeklyStats.rideDuration += dayData.rideDuration;
                weeklyStats.rideDistance += dayData.rideDistance;
            }
            if (dayData.strengthDuration > 0) {
                const size = calculateSize(dayData.strengthDuration, globalMax.duration);
                dotsContainer.appendChild(createDot('STRENGTH', size, dayData.strengthDuration));
                weeklyStats.strengthDuration += dayData.strengthDuration;
            }
        }

        cell.appendChild(dotsContainer);
        weekRow.appendChild(cell);

        if (current.getDay() === 0) {
            const summaryCell = document.createElement('div');
            summaryCell.className = 'summary-cell';

            let summaryHTML = '<strong>Total:</strong><br>';
            if (weeklyStats.runDistance > 0) {
                const miles = weeklyStats.runDistance / 1609.34;
                let paceStr = '';
                if (weeklyStats.runDuration > 0 && miles > 0) {
                    const totalMinutes = weeklyStats.runDuration / 60;
                    const pace = totalMinutes / miles;
                    const paceMin = Math.floor(pace);
                    const paceSec = Math.floor((pace - paceMin) * 60);
                    paceStr = `, ${paceMin}:${paceSec.toString().padStart(2, '0')}`;
                }
                summaryHTML += `Run: ${miles.toFixed(1)} mi${paceStr}<br>`;
            }
            if (weeklyStats.rideDuration > 0) {
                let rideDistStr = '';
                if (weeklyStats.rideDistance > 0) {
                    rideDistStr = `${(weeklyStats.rideDistance / 1609.34).toFixed(1)} mi, `;
                }
                summaryHTML += `Ride: ${rideDistStr}${formatDuration(weeklyStats.rideDuration)}<br>`;
            }
            if (weeklyStats.strengthDuration > 0) {
                summaryHTML += `Strength: ${formatDuration(weeklyStats.strengthDuration)}`;
            }

            if (weeklyStats.runDistance === 0 && weeklyStats.rideDuration === 0 && weeklyStats.strengthDuration === 0) {
                summaryHTML += '-';
            }

            summaryCell.innerHTML = summaryHTML;
            weekRow.appendChild(summaryCell);

            visualizationContainer.appendChild(weekRow);

            weekRow = document.createElement('div');
            weekRow.className = 'week-row';

            weeklyStats = {runDistance: 0, runDuration: 0, rideDuration: 0, rideDistance: 0, strengthDuration: 0};
        }

        current.setDate(current.getDate() + 1);
    }
}

function calculateSize(value, max) {
    const sizingMax = Math.min(Math.max(max, 1), 10800);
    if (sizingMax === 0) return MIN_DOT_PX;
    const ratio = Math.min(value / sizingMax, 1.0);
    return MIN_DOT_PX + (ratio * (MAX_DOT_PX - MIN_DOT_PX));
}

function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
}

function createDot(type, size, value) {
    const dot = document.createElement('div');
    dot.className = 'activity-dot';
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.backgroundColor = DOT_COLORS[type];

    let text = '';
    let unit = '';
    if (type === 'RUN') {
        const miles = value / 1609.34;
        text = miles.toFixed(1);
        unit = 'mi';
    } else {
        text = Math.round(value / 60);
        unit = 'm';
    }

    dot.textContent = text + (unit ? ` ${unit}` : '');
    dot.title = `${type}: ${text} ${unit}`;

    return dot;
}

function updateYearControls() {
    let yearSelect = document.getElementById('yearSelect');

    if (!yearSelect) {
        const controlsDiv = document.querySelector('.controls');
        const wrapper = document.createElement('div');
        wrapper.className = 'year-control-wrapper';

        const label = document.createElement('label');
        label.textContent = 'Year: ';
        label.htmlFor = 'yearSelect';
        label.style.color = 'var(--text-secondary)';
        label.style.fontSize = '14px';
        label.style.marginRight = '8px';

        yearSelect = document.createElement('select');
        yearSelect.id = 'yearSelect';
        yearSelect.className = 'year-select';
        yearSelect.addEventListener('change', (e) => {
            currentYear = parseInt(e.target.value, 10);
            if (AuthService.isLoggedIn()) {
                loadDataFromAPI();
            } else {
                renderVisualization();
            }
        });

        wrapper.appendChild(label);
        wrapper.appendChild(yearSelect);

        const legend = controlsDiv.querySelector('.legend');
        controlsDiv.insertBefore(wrapper, legend);
    }

    yearSelect.innerHTML = '';
    const sortedYears = Array.from(availableYears).sort((a, b) => b - a);

    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
    });
}

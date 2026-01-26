// ===== Constants =====
const DISTANCES = {
    '5': {name: '5K', km: 5},
    '10': {name: '10K', km: 10},
    '21.0975': {name: 'Half Marathon', km: 21.0975},
    '42.195': {name: 'Marathon', km: 42.195},
    '50': {name: '50K', km: 50}
};

const KM_TO_MI = 0.621371;
const MI_TO_KM = 1.60934;

// ===== State =====
let currentMode = 'pace'; // 'pace', 'time', or 'distance'
let selectedDistance = 'custom';

// ===== DOM Elements =====
const modeButtons = document.querySelectorAll('.mode-btn');
const distanceButtons = document.querySelectorAll('.distance-btn');
const distanceGroup = document.getElementById('distance-group');
const timeGroup = document.getElementById('time-group');
const paceGroup = document.getElementById('pace-group');
const customDistanceInput = document.getElementById('custom-distance-input');
const distanceValue = document.getElementById('distance-value');
const distanceUnit = document.getElementById('distance-unit');
const hoursInput = document.getElementById('hours');
const minutesInput = document.getElementById('minutes');
const secondsInput = document.getElementById('seconds');
const paceMinutesInput = document.getElementById('pace-minutes');
const paceSecondsInput = document.getElementById('pace-seconds');
const paceUnitSelect = document.getElementById('pace-unit');
const calculateBtn = document.getElementById('calculate-btn');
const resultsSection = document.getElementById('results-section');
const resultsGrid = document.getElementById('results-grid');
const paceChartSection = document.getElementById('pace-chart-section');
const paceChart = document.getElementById('pace-chart');

// ===== Event Listeners =====
modeButtons.forEach(btn => {
    btn.addEventListener('click', () => selectMode(btn.dataset.mode));
});

distanceButtons.forEach(btn => {
    btn.addEventListener('click', () => selectDistance(btn.dataset.distance));
});

calculateBtn.addEventListener('click', calculate);

// Allow Enter key to trigger calculation
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        calculate();
    }
});

// ===== Functions =====
function selectMode(mode) {
    currentMode = mode;

    // Update mode button states
    modeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Show/hide input groups based on mode
    distanceGroup.classList.toggle('hidden', mode === 'distance');
    timeGroup.classList.toggle('hidden', mode === 'time');
    paceGroup.classList.toggle('hidden', mode === 'pace');

    // Hide results when mode changes
    hideResults();
}

function selectDistance(distance) {
    selectedDistance = distance;

    // Update distance button states
    distanceButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.distance === distance);
    });

    // Show/hide custom distance input
    if (distance === 'custom') {
        customDistanceInput.style.display = 'flex';
        distanceValue.value = '';
        distanceUnit.value = 'mi';
        distanceValue.focus();
    } else {
        customDistanceInput.style.display = 'flex';
        distanceValue.value = DISTANCES[distance].km;
        distanceUnit.value = 'km';
    }

    hideResults();
}

function getDistanceInKm() {
    let distance = parseFloat(distanceValue.value);
    if (isNaN(distance) || distance <= 0) return null;

    if (distanceUnit.value === 'mi') {
        distance = distance * MI_TO_KM;
    }

    return distance;
}

function getTimeInSeconds() {
    const hours = parseInt(hoursInput.value) || 0;
    const minutes = parseInt(minutesInput.value) || 0;
    const seconds = parseInt(secondsInput.value) || 0;

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return totalSeconds > 0 ? totalSeconds : null;
}

function getPaceInSecondsPerKm() {
    const minutes = parseInt(paceMinutesInput.value) || 0;
    const seconds = parseInt(paceSecondsInput.value) || 0;

    let paceSeconds = minutes * 60 + seconds;
    if (paceSeconds <= 0) return null;

    // Convert to seconds per km if pace is per mile
    if (paceUnitSelect.value === 'mi') {
        paceSeconds = paceSeconds / MI_TO_KM;
    }

    return paceSeconds;
}

function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.round(totalSeconds % 60);

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
}

function formatPace(secondsPerUnit) {
    const minutes = Math.floor(secondsPerUnit / 60);
    const seconds = Math.round(secondsPerUnit % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function calculate() {
    hideResults();

    let results = [];

    switch (currentMode) {
        case 'pace':
            results = calculatePace();
            break;
        case 'time':
            results = calculateTime();
            break;
        case 'distance':
            results = calculateDistance();
            break;
    }

    if (results.length > 0) {
        displayResults(results);
    }
}

function calculatePace() {
    const distanceKm = getDistanceInKm();
    const timeSeconds = getTimeInSeconds();

    if (!distanceKm || !timeSeconds) {
        showError('Please enter valid distance and time');
        return [];
    }

    const paceSecondsPerKm = timeSeconds / distanceKm;
    const paceSecondsPerMi = paceSecondsPerKm * MI_TO_KM;

    const distanceMi = distanceKm * KM_TO_MI;

    const results = [
        {
            label: 'Pace',
            value: formatPace(paceSecondsPerMi),
            unit: 'min/mile',
            primary: true
        },
        {
            label: 'Pace',
            value: formatPace(paceSecondsPerKm),
            unit: 'min/km',
            primary: true
        },
        {
            label: 'Total Time',
            value: formatTime(timeSeconds),
            unit: ''
        },
        {
            label: 'Distance',
            value: distanceKm.toFixed(2),
            unit: 'km'
        },
        {
            label: 'Distance',
            value: distanceMi.toFixed(2),
            unit: 'miles'
        },
        {
            label: 'Speed',
            value: ((distanceKm / timeSeconds) * 3600).toFixed(2),
            unit: 'km/h'
        }
    ];

    // Generate split times
    generateSplits(distanceKm, paceSecondsPerKm);

    return results;
}

function calculateTime() {
    const distanceKm = getDistanceInKm();
    const paceSecondsPerKm = getPaceInSecondsPerKm();

    if (!distanceKm || !paceSecondsPerKm) {
        showError('Please enter valid distance and pace');
        return [];
    }

    const totalTimeSeconds = distanceKm * paceSecondsPerKm;
    const paceSecondsPerMi = paceSecondsPerKm * MI_TO_KM;
    const distanceMi = distanceKm * KM_TO_MI;

    const results = [
        {
            label: 'Total Time',
            value: formatTime(totalTimeSeconds),
            unit: '',
            primary: true
        },
        {
            label: 'Distance',
            value: distanceKm.toFixed(2),
            unit: 'km'
        },
        {
            label: 'Distance',
            value: distanceMi.toFixed(2),
            unit: 'miles'
        },
        {
            label: 'Pace',
            value: formatPace(paceSecondsPerMi),
            unit: 'min/mile'
        },
        {
            label: 'Pace',
            value: formatPace(paceSecondsPerKm),
            unit: 'min/km'
        }
    ];

    // Generate split times
    generateSplits(distanceKm, paceSecondsPerKm);

    return results;
}

function calculateDistance() {
    const timeSeconds = getTimeInSeconds();
    const paceSecondsPerKm = getPaceInSecondsPerKm();

    if (!timeSeconds || !paceSecondsPerKm) {
        showError('Please enter valid time and pace');
        return [];
    }

    const distanceKm = timeSeconds / paceSecondsPerKm;
    const distanceMi = distanceKm * KM_TO_MI;
    const paceSecondsPerMi = paceSecondsPerKm * MI_TO_KM;

    const results = [
        {
            label: 'Distance',
            value: distanceKm.toFixed(2),
            unit: 'km',
            primary: true
        },
        {
            label: 'Distance',
            value: distanceMi.toFixed(2),
            unit: 'miles',
            primary: true
        },
        {
            label: 'Total Time',
            value: formatTime(timeSeconds),
            unit: ''
        },
        {
            label: 'Pace',
            value: formatPace(paceSecondsPerMi),
            unit: 'min/mile'
        },
        {
            label: 'Pace',
            value: formatPace(paceSecondsPerKm),
            unit: 'min/km'
        }
    ];

    // Generate split times
    generateSplits(distanceKm, paceSecondsPerKm);

    return results;
}

function displayResults(results) {
    resultsGrid.innerHTML = '';

    results.forEach(result => {
        const card = document.createElement('div');
        card.className = `result-card${result.primary ? ' primary' : ''}`;
        card.innerHTML = `
            <div class="result-label">${result.label}</div>
            <div class="result-value">${result.value}</div>
            <div class="result-unit">${result.unit}</div>
        `;
        resultsGrid.appendChild(card);
    });

    resultsSection.classList.remove('hidden');
}

function generateSplits(distanceKm, paceSecondsPerKm) {
    paceChart.innerHTML = '';

    // Determine split interval based on distance
    let splitInterval = 1; // km
    if (distanceKm > 30) {
        splitInterval = 5;
    } else if (distanceKm > 15) {
        splitInterval = 2;
    }

    let currentDistance = splitInterval;
    while (currentDistance <= distanceKm) {
        const splitTime = currentDistance * paceSecondsPerKm;
        const row = document.createElement('div');
        row.className = 'split-row';
        row.innerHTML = `
            <span class="split-distance">${currentDistance} km</span>
            <span class="split-time">${formatTime(splitTime)}</span>
        `;
        paceChart.appendChild(row);
        currentDistance += splitInterval;
    }

    // Add final distance if not already included
    if (Math.abs(currentDistance - splitInterval - distanceKm) > 0.01) {
        const finalTime = distanceKm * paceSecondsPerKm;
        const row = document.createElement('div');
        row.className = 'split-row';
        row.innerHTML = `
            <span class="split-distance">${distanceKm.toFixed(2)} km (Finish)</span>
            <span class="split-time">${formatTime(finalTime)}</span>
        `;
        paceChart.appendChild(row);
    }

    paceChartSection.classList.remove('hidden');
}

function hideResults() {
    resultsSection.classList.add('hidden');
    paceChartSection.classList.add('hidden');
}

function showError(message) {
    // Create a simple error notification
    const existingError = document.querySelector('.error-toast');
    if (existingError) {
        existingError.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-weight: 500;
        z-index: 1000;
        box-shadow: 0 4px 20px rgba(238, 90, 36, 0.3);
        animation: fadeInDown 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeInUp 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
    // Set initial state
    selectMode('pace');
    selectDistance('custom');
});

import {statesList} from './data.js';

// DOM Elements
const statesGrid = document.getElementById('states-grid');
const modalOverlay = document.getElementById('modal-overlay');
const modalStateName = document.getElementById('modal-state-name');
const marathonForm = document.getElementById('marathon-form');
const closeModalBtn = document.getElementById('close-modal');
const cancelBtn = document.getElementById('cancel-btn');
const statusSelect = document.getElementById('status');
const raceDetailsDiv = document.getElementById('race-details');
const marathonOptionsDiv = document.getElementById('marathon-options');
const marathonOptionsList = document.getElementById('marathon-options-list');
const resetBtn = document.getElementById('reset-btn');
const completedCountEl = document.getElementById('completed-count');
const plannedCountEl = document.getElementById('planned-count');
const remainingCountEl = document.getElementById('remaining-count');
const progressFill = document.getElementById('progress-fill');

// State
let userProgress = JSON.parse(localStorage.getItem('marathon50Progress')) || {};
let currentStateCode = null;
let marathonOptionsByState = {};

// Initialize
async function init() {
    await loadMarathonOptions();
    renderDashboard();
    renderGrid();
    setupEventListeners();
}

// Load marathon options from CSV
async function loadMarathonOptions() {
    try {
        const response = await fetch('collected-us-marathon.csv');

        // Check if the request was successful
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const csvText = await response.text();

        // Check if we got valid content
        if (!csvText || csvText.trim().length === 0) {
            throw new Error('CSV file is empty');
        }

        const lines = csvText.trim().split('\n');

        // Validate we have at least a header and one data row
        if (lines.length < 2) {
            throw new Error('CSV file has no data rows');
        }

        let loadedCount = 0;

        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Parse CSV line properly handling commas in quoted fields
            const columns = parseCSVLine(line);

            // Validate we have enough columns
            if (columns.length < 8) {
                console.warn(`Skipping malformed row ${i}: insufficient columns`);
                continue;
            }

            const stateCode = columns[1];

            // Validate state code
            if (!stateCode || stateCode.length !== 2) {
                console.warn(`Skipping row ${i}: invalid state code "${stateCode}"`);
                continue;
            }

            const marathon = {
                name: columns[2] || 'Unknown Marathon',
                city: columns[3] || 'Unknown City',
                finishers: columns[4] || 'N/A',
                courseType: columns[5] || 'Unknown',
                elevationGain: columns[6] || '-',
                elevationLoss: columns[7] || '-',
                date: columns[8]
            };

            if (!marathonOptionsByState[stateCode]) {
                marathonOptionsByState[stateCode] = [];
            }
            marathonOptionsByState[stateCode].push(marathon);
            loadedCount++;
        }

        console.log(`Loaded ${loadedCount} marathon options across ${Object.keys(marathonOptionsByState).length} states`);

    } catch (error) {
        console.error('Failed to load marathon options:', error.message);
        // Set a flag to indicate marathon options are unavailable
        marathonOptionsByState = {};
        // The UI will handle showing "No marathon data available" when options are empty
    }
}

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());

    return result;
}

// Render Dashboard Stats
function renderDashboard() {
    const completed = Object.values(userProgress).filter(s => s.status === 'completed').length;
    const planned = Object.values(userProgress).filter(s => s.status === 'planned').length;
    const remaining = 50 - completed;

    completedCountEl.textContent = completed;
    plannedCountEl.textContent = planned;
    remainingCountEl.textContent = remaining;

    const percentage = (completed / 50) * 100;
    progressFill.style.width = `${percentage}%`;
}

// Render States Grid
function renderGrid() {
    statesGrid.innerHTML = '';

    statesList.forEach(state => {
        const stateData = userProgress[state.code];
        const status = stateData ? stateData.status : 'none';

        const card = document.createElement('div');
        card.className = `state-card ${status === 'completed' ? 'completed' : status === 'planned' ? 'planned' : ''}`;
        card.onclick = () => openModal(state);

        let statusLabel = '';
        if (status === 'completed') {
            const year = stateData.raceDate ? stateData.raceDate.split('-')[0] : '';
            const time = stateData.finishTime || '';

            if (year || time) {
                const text = [year, time].filter(Boolean).join(' - ');
                statusLabel = `<div class="status-badge">${text}</div>`;
            } else {
                statusLabel = '<div class="status-badge">Completed</div>';
            }
        } else if (status === 'planned') {
            const raceName = stateData.raceName || '';
            const text = raceName ? `Planned: ${raceName}` : 'Planned';
            statusLabel = `<div class="status-badge">${text}</div>`;
        }

        card.innerHTML = `
            <div class="state-code">${state.code}</div>
            <div class="state-name">${state.name}</div>
            ${statusLabel}
        `;

        statesGrid.appendChild(card);
    });
}

// Modal Logic
function openModal(state) {
    currentStateCode = state.code;
    modalStateName.textContent = state.name;

    // Reset form
    marathonForm.reset();

    // Fill data if exists
    const data = userProgress[state.code];
    if (data) {
        statusSelect.value = data.status || 'not started';
        document.getElementById('race-name').value = data.raceName || '';
        document.getElementById('race-date').value = data.raceDate || '';
        document.getElementById('finish-time').value = data.finishTime || '';
        document.getElementById('notes').value = data.notes || '';
    } else {
        statusSelect.value = 'not started';
    }

    toggleRaceDetails();
    modalOverlay.classList.add('open');
}

function closeModal() {
    modalOverlay.classList.remove('open');
    currentStateCode = null;
}

function toggleRaceDetails() {
    const status = statusSelect.value;
    const stateData = userProgress[currentStateCode];
    const isCompleted = stateData && stateData.status === 'completed';

    // Show marathon options when status is 'not started' or planned (but not for already completed states)
    if ((status === 'not started' || status === 'planned') && !isCompleted) {
        renderMarathonOptions(currentStateCode);
        marathonOptionsDiv.classList.remove('hidden');
    } else {
        marathonOptionsDiv.classList.add('hidden');
    }

    if (status === 'not started') {
        raceDetailsDiv.classList.add('hidden');
    } else {
        raceDetailsDiv.classList.remove('hidden');

        // Hide finish time if only planned
        if (status === 'planned') {
            document.getElementById('finish-time-group').classList.add('hidden');
        } else {
            document.getElementById('finish-time-group').classList.remove('hidden');
        }
    }
}

// Render marathon options for a state
function renderMarathonOptions(stateCode) {
    marathonOptionsList.innerHTML = '';

    const options = marathonOptionsByState[stateCode];
    if (!options || options.length === 0) {
        marathonOptionsList.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem;">No marathon data available for this state.</p>';
        return;
    }

    options.forEach(marathon => {
        const optionEl = document.createElement('div');
        optionEl.className = 'marathon-option';
        optionEl.innerHTML = `
            <div class="marathon-option-header">
                <span class="marathon-option-name">${marathon.name}</span>
            </div>
            <div class="marathon-option-city">${marathon.city} · ${marathon.date}</div>
            <div class="marathon-option-details">
                <span class="marathon-option-tag course-type">${marathon.courseType}</span>
                <span class="marathon-option-tag finishers">${marathon.finishers} finishers</span>
                <span class="marathon-option-tag elevation">↑${marathon.elevationGain}ft ↓${marathon.elevationLoss}ft</span>
            </div>
        `;

        optionEl.addEventListener('click', () => selectMarathonOption(marathon));
        marathonOptionsList.appendChild(optionEl);
    });
}

// Select a marathon option and fill the form
function selectMarathonOption(marathon) {
    document.getElementById('race-name').value = marathon.name;

    // If status is "not started", automatically change to "planned"
    if (statusSelect.value === 'not started') {
        statusSelect.value = 'planned';
        toggleRaceDetails();
    }
}

// Save Data
function saveProgress(e) {
    e.preventDefault();
    if (!currentStateCode) return;

    const status = statusSelect.value;

    if (status === 'not started') {
        delete userProgress[currentStateCode];
    } else {
        const formData = new FormData(marathonForm);
        userProgress[currentStateCode] = {
            status: status,
            raceName: formData.get('raceName'),
            raceDate: formData.get('raceDate'),
            finishTime: formData.get('finishTime'),
            notes: formData.get('notes')
        };
    }

    localStorage.setItem('marathon50Progress', JSON.stringify(userProgress));

    renderDashboard();
    renderGrid();
    closeModal();
}

// Reset Data
function resetData() {
    if (confirm('Are you sure you want to reset all data? This will set all states to "Not Started" and cannot be undone.')) {
        userProgress = {};
        localStorage.removeItem('marathon50Progress');

        renderDashboard();
        renderGrid();
    }
}

// Export Data
function exportData() {
    const dataStr = JSON.stringify(userProgress, null, 2);
    const blob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `50-states-marathon-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Import Data
function importData(file) {
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);

            // Validate the imported data structure
            if (typeof importedData !== 'object' || importedData === null) {
                throw new Error('Invalid data format');
            }

            // Check if it has valid state codes
            const validStateCodes = statesList.map(s => s.code);
            const importedCodes = Object.keys(importedData);
            const invalidCodes = importedCodes.filter(code => !validStateCodes.includes(code));

            if (invalidCodes.length > 0) {
                console.warn(`Ignoring invalid state codes: ${invalidCodes.join(', ')}`);
            }

            // Filter to only valid state codes
            const validData = {};
            importedCodes.forEach(code => {
                if (validStateCodes.includes(code)) {
                    validData[code] = importedData[code];
                }
            });

            if (confirm(`Import ${Object.keys(validData).length} state records? This will replace your current data.`)) {
                userProgress = validData;
                localStorage.setItem('marathon50Progress', JSON.stringify(userProgress));

                renderDashboard();
                renderGrid();

                alert('Data imported successfully!');
            }
        } catch (error) {
            console.error('Import error:', error);
            alert('Failed to import data. Please ensure the file is a valid JSON export.');
        }
    };

    reader.onerror = () => {
        alert('Error reading file. Please try again.');
    };

    reader.readAsText(file);
}

// Event Listeners
function setupEventListeners() {
    closeModalBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    statusSelect.addEventListener('change', toggleRaceDetails);

    marathonForm.addEventListener('submit', saveProgress);

    if (resetBtn) {
        resetBtn.addEventListener('click', resetData);
    }

    // Export button
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportData);
    }

    // Import file input
    const importInput = document.getElementById('import-input');
    if (importInput) {
        importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                importData(file);
                e.target.value = ''; // Reset input
            }
        });
    }
}

// Run
init();

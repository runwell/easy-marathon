// World Athletics Records - Data fetching and display

const JSON_URL = 'https://artcmd.github.io/marathon-collections/world-athletics/records.json';

let recordsData = null;
let currentGender = 'men';

// Distance display names
const DISTANCE_LABELS = {
    '5000': '5000m',
    '10000': '10000m',
    'half mara': 'Half Marathon',
    'marathon': 'Marathon'
};

// Region display names
const REGION_LABELS = {
    'world': '\u{1F30D} World',
    'usa': '\u{1F1FA}\u{1F1F8} USA',
    'japan': '\u{1F1EF}\u{1F1F5} Japan'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupTabListeners();
    fetchRecords();
});

// Set up tab button listeners
function setupTabListeners() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update current gender and re-render
            currentGender = btn.dataset.gender;
            if (recordsData) {
                renderRecords();
            }
        });
    });
}

// Fetch records from JSON URL
async function fetchRecords() {
    try {
        const response = await fetch(JSON_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        recordsData = await response.json();
        renderRecords();
    } catch (error) {
        console.error('Error fetching records:', error);
        document.getElementById('alltime-column').innerHTML = '<h2>All-Time Records</h2><div class="loading">Error loading data</div>';
        document.getElementById('recent-column').innerHTML = '<h2>Recent Two Years</h2><div class="loading">Error loading data</div>';
    }
}

// Render records for current gender
function renderRecords() {
    const alltimeColumn = document.getElementById('alltime-column');
    const recentColumn = document.getElementById('recent-column');

    // Render All-Time records
    alltimeColumn.innerHTML = '<h2>All-Time Records</h2>';
    if (recordsData.allTime && recordsData.allTime[currentGender]) {
        alltimeColumn.innerHTML += renderRegionTables(recordsData.allTime[currentGender]);
    }

    // Render Recent Two Years records
    recentColumn.innerHTML = '<h2>Recent Two Years</h2>';
    if (recordsData.recent2Years && recordsData.recent2Years[currentGender]) {
        recentColumn.innerHTML += renderRegionTables(recordsData.recent2Years[currentGender]);
    }
}

// Render tables for all regions (world, usa, japan)
function renderRegionTables(genderData) {
    let html = '';

    for (const [region, records] of Object.entries(genderData)) {
        if (!REGION_LABELS[region]) continue;

        html += `
            <div class="record-section">
                <h3>${REGION_LABELS[region]}</h3>
                ${renderTable(records)}
            </div>
        `;
    }

    return html;
}

// Render a single table for a region
function renderTable(records) {
    if (!records || records.length === 0) {
        return '<p class="loading">No data available</p>';
    }

    // Build table with 5 columns: # and 4 distances (each showing time + athlete stacked)
    let html = `
        <table class="records-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>5000m</th>
                    <th>10000m</th>
                    <th>Half</th>
                    <th>Marathon</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Show top 10 records
    const displayRecords = records.slice(0, 10);
    displayRecords.forEach((record, index) => {
        html += `
            <tr>
                <td>${index + 1}</td>
                <td class="stacked-cell">
                    <span class="time">${record['5000'] || '-'}</span>
                    <span class="athlete" title="${record['Athlete1'] || ''}">${record['Athlete1'] || '-'}</span>
                </td>
                <td class="stacked-cell">
                    <span class="time">${record['10000'] || '-'}</span>
                    <span class="athlete" title="${record['Athlete2'] || ''}">${record['Athlete2'] || '-'}</span>
                </td>
                <td class="stacked-cell">
                    <span class="time">${record['half mara'] || '-'}</span>
                    <span class="athlete" title="${record['Athlete3'] || ''}">${record['Athlete3'] || '-'}</span>
                </td>
                <td class="stacked-cell">
                    <span class="time">${record['marathon'] || '-'}</span>
                    <span class="athlete" title="${record['Athlete4'] || ''}">${record['Athlete4'] || '-'}</span>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    return html;
}

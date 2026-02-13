"""
Collect US Marathon Data from findmymarathon.com

This script scrapes marathon race data for all 50 US states using browser automation.
It collects top 3 certified races per state (by finisher count), filtering out "Very Hilly" courses.
"""

import asyncio
import csv
import re

from playwright.async_api import async_playwright

# US States with their codes
US_STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
    "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY"
}

# Valid course types (exclude "Very Hilly")
VALID_COURSE_TYPES = ["Flat", "Mostly Flat", "Downhill", "Hilly", "Rolling Hills"]


async def extract_elevation_data(page, race_name):
    """Extract elevation gain and loss from a race detail page."""
    try:
        # Navigate to race detail page
        encoded_name = race_name.replace(' ', '%20')
        url = f"https://findmymarathon.com/race-detail.php?zname={encoded_name}#Elevation"

        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(1)  # Wait for page to load

        # Extract elevation data
        content = await page.content()

        # Look for elevation gain pattern: "XXX feet" or "XXX ft"
        gain_match = re.search(r'Elevation Gain[:\s]*(\d+(?:,\d+)?)\s*(?:feet|ft)', content, re.IGNORECASE)
        loss_match = re.search(r'Elevation Loss[:\s]*(\d+(?:,\d+)?)\s*(?:feet|ft)', content, re.IGNORECASE)

        # Alternative patterns - look in specific sections
        if not gain_match or not loss_match:
            elevation_text = await page.evaluate('''
            () => {
                const elevSection = document.querySelector('#Elevation, [id*="elevation"], .elevation');
                if (elevSection) return elevSection.innerText;

                // Try to find elevation mentions in the page
                const allText = document.body.innerText;
                const elevMatch = allText.match(/elevation[\\s\\S]*?(?:gain|loss)[\\s\\S]*?\\d+/gi);
                return elevMatch ? elevMatch.join(' | ') : '';
            }
            ''')

            if elevation_text:
                gain_match = re.search(r'(?:Elevation\s*)?Gain[:\s]*(\d+(?:,\d+)?)', elevation_text, re.IGNORECASE)
                loss_match = re.search(r'(?:Elevation\s*)?Loss[:\s]*(\d+(?:,\d+)?)', elevation_text, re.IGNORECASE)

        gain = gain_match.group(1).replace(',', '') if gain_match else "-"
        loss = loss_match.group(1).replace(',', '') if loss_match else "-"

        return gain, loss

    except Exception as e:
        print(f"    Error getting elevation for {race_name}: {e}")
        return "-", "-"


async def parse_races_from_html(page, state, state_code):
    """Parse race information from the state page using JavaScript."""

    races = await page.evaluate('''
    () => {
        const results = [];

        // Get all table rows
        const rows = document.querySelectorAll('tr');

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.cells;

            // Skip rows without enough cells (header rows, etc.)
            if (!cells || cells.length < 4) continue;

            // First cell contains marathon name and city
            // Spotlight marathons: h1 = name, h3 = city
            // Regular marathons: h3 = name, h4 = city
            const h1Element = cells[0].querySelector('h1');
            const h3Element = cells[0].querySelector('h3');
            const h4Element = cells[0].querySelector('h4');

            let nameElement, cityElement;

            if (h1Element) {
                // Spotlight marathon
                nameElement = h1Element;
                cityElement = h3Element;  // h3 contains city for spotlight marathons
            } else if (h3Element) {
                // Regular marathon
                nameElement = h3Element;
                cityElement = h4Element;
            } else {
                continue;  // No name element found
            }

            if (!nameElement) continue;

            // Extract race name from the link
            const raceLink = nameElement.querySelector('a[href*="race-detail"]');
            let raceName = '';
            if (raceLink) {
                raceName = raceLink.innerText.trim();
            } else {
                raceName = nameElement.innerText.trim();
            }

            // Skip if no race name
            if (!raceName) continue;

            // Extract city from city element (format: "City, STATE")
            let city = '';
            let raceDate = '';
            if (cityElement) {
                const cityText = cityElement.innerText.trim();
                const cityParts = cityText.split(',');
                if (cityParts.length > 0) {
                    city = cityParts[0].trim();
                }

                // Extract date from span[itemprop="startDate"]
                const dateSpan = cityElement.querySelector('span[itemprop="startDate"]');
                if (dateSpan) {
                    raceDate = dateSpan.getAttribute('content') || dateSpan.innerText.trim();
                }
            }

            // Second cell (index 1) contains course type in h4
            let courseType = '';
            if (cells[1]) {
                const courseH4 = cells[1].querySelector('h4');
                if (courseH4) {
                    courseType = courseH4.innerText.trim();
                } else {
                    courseType = cells[1].innerText.trim();
                }
            }

            // Normalize "Very Flat" to "Flat" per requirements
            if (courseType === 'Very Flat') {
                courseType = 'Flat';
            }

            // Check for Very Hilly - skip if found
            if (courseType === 'Very Hilly') continue;

            // Fourth cell (index 3) contains finishers count
            let finishers = 0;
            if (cells[3]) {
                const finisherText = cells[3].innerText || '';
                const finisherMatch = finisherText.match(/(\\d+(?:,\\d+)?)\\s*Finisher/i);
                if (finisherMatch) {
                    finishers = parseInt(finisherMatch[1].replace(/,/g, ''));
                }
            }

            // Fifth cell (index 4) may indicate "Course is Not Certified"
            if (cells[4]) {
                const certText = cells[4].innerText || '';
                if (certText.toLowerCase().includes('not certified')) {
                    continue;  // Skip non-certified courses
                }
            }

            // Only add if we have finisher data and at least 100 finishers
            if (finishers < 100) continue;

            results.push({
                name: raceName,
                city: city,
                date: raceDate || '-',
                finishers: finishers,
                courseType: courseType || '-'
            });
        }

        // Sort by finishers descending
        results.sort((a, b) => b.finishers - a.finishers);

        return results;
    }
    ''')

    return races


async def collect_state_data(page, state, state_code, max_races=5):
    """Collect marathon data for a single state."""
    print(f"Processing {state} ({state_code})...")

    try:
        # Navigate to state calendar page
        url = f"https://findmymarathon.com/calendar-state.php?state={state.replace(' ', '%20')}&sort=finishersd#calendar"
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)  # Wait for page to load fully

        # Parse races from the page
        races = await parse_races_from_html(page, state, state_code)

        # Get top races (up to max_races)
        top_races = races[:max_races]

        print(f"  Found {len(races)} valid races, collecting top {len(top_races)}")

        # Collect elevation data for each race
        race_data = []
        for race in top_races:
            print(f"    Getting elevation for: {race['name']}")
            gain, loss = await extract_elevation_data(page, race['name'])

            race_data.append({
                'State': state,
                'State_Code': state_code,
                'Marathon Name': race['name'],
                'City': race['city'],
                'Date': race['date'],
                'Finishers': race['finishers'],
                'Course Type': race['courseType'],
                'Elevation Gain (ft)': gain,
                'Elevation Loss (ft)': loss
            })

            await asyncio.sleep(0.5)  # Be nice to the server

        return race_data

    except Exception as e:
        print(f"  Error processing {state}: {e}")
        return []


async def main():
    """Main function to collect all marathon data."""
    print("Starting marathon data collection...")
    print(f"Processing {len(US_STATES)} states\n")

    all_races = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        for state, state_code in US_STATES.items():
            races = await collect_state_data(page, state, state_code)
            all_races.extend(races)

            # Brief pause between states
            await asyncio.sleep(1)

        await browser.close()

    # Save to CSV
    output_file = "50states-tracker/collected-us-marathon.csv"
    fieldnames = ['State', 'State_Code', 'Marathon Name', 'City', 'Finishers',
                  'Course Type', 'Elevation Gain (ft)', 'Elevation Loss (ft)', 'Date']

    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_races)

    print(f"\n{'=' * 50}")
    print(f"Collection complete!")
    print(f"Total races collected: {len(all_races)}")
    print(f"Output saved to: {output_file}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    asyncio.run(main())

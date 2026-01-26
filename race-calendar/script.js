const {DateTime} = luxon;

document.getElementById('generatorForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const name = document.getElementById('raceName').value;
    const date = document.getElementById('raceDate').value;
    const time = document.getElementById('raceTime').value;
    const zone = document.getElementById('timeZone').value;
    const activityType = document.querySelector('input[name="activityType"]:checked').value;

    if (!name || !date || !time || !zone) {
        alert("Please fill in all fields");
        return;
    }

    // 1. Create a Luxon DateTime in the RACE's timezone
    // Format: yyyy-MM-ddTHH:mm
    const raceStartLocal = DateTime.fromISO(`${date}T${time}`, {zone: zone});

    if (!raceStartLocal.isValid) {
        alert("Invalid date or time");
        return;
    }

    // 2. Determine Duration
    const durationHours = activityType === 'watch' ? 2.5 : 3.5;

    // 3. Calculate End Time
    const raceEndLocal = raceStartLocal.plus({hours: durationHours});

    // 4. Convert to UTC for the standard ICS format
    // Although the user asked for EST, using UTC (Z) is the standard way to ensure
    // the event appears at the correct absolute time in ANY calendar (including one set to EST).
    // Using explicit TZID requires defining the VTIMEZONE which is very verbose.
    // UTC is "universal" and thus safe.
    const startUTC = raceStartLocal.toUTC();
    const endUTC = raceEndLocal.toUTC();

    // 5. Generate ICS Content
    const now = DateTime.now().toUTC();
    const cleanDate = (isoStr) => isoStr.replace(/[-:]/g, '').split('.')[0] + 'Z';

    const uid = `marathon-${now.toMillis()}@runner.app`;

    // Create a description that mentions the original local time for clarity
    const description = `Race: ${name}\nLocal Time: ${raceStartLocal.toFormat('yyyy-MM-dd HH:mm')} (${zone})\nDuration: ${durationHours} hours (${activityType})`;

    const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//MarathonApp//EN',
        'calscale:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${cleanDate(now.toISO())}`,
        `DTSTART:${cleanDate(startUTC.toISO())}`,
        `DTEND:${cleanDate(endUTC.toISO())}`,
        `SUMMARY:${name} (${activityType === 'watch' ? 'Watch' : 'Run'})`,
        `DESCRIPTION:${description}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');

    // 6. Download File
    const blob = new Blob([icsContent], {type: 'text/calendar;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/\s+/g, '_')}_${activityType}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// lib/calendar-share.ts

// 1. WhatsApp Deel-Link Generator
export function getWhatsAppShareUrl(
  trainerName: string,
  sport: string,
  dateLabel: string,
  timeLabel: string,
  venueName: string
): string {
  const text =
    `Hé! Ik heb onze ${sport.toLowerCase()}training bij ${trainerName} ` +
    `geboekt op ${dateLabel} om ${timeLabel} uur bij ${venueName} ` +
    `via GowTrain! ` +
    `Zie je op de baan!`;

  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// 2. Google Calendar Link Generator
export function getGoogleCalendarUrl(
  title: string,
  startsAtIso: string,
  endsAtIso: string,
  venueName: string,
  description: string
): string {
  const start = new Date(startsAtIso).toISOString().replace(/-|:|\.\d+/g, "");
  const end = new Date(endsAtIso).toISOString().replace(/-|:|\.\d+/g, "");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${start}/${end}`,
    details: description,
    location: venueName,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// 3. Apple Calendar / Outlook (.ics bestand) Download
export function downloadIcsFile(
  title: string,
  startsAtIso: string,
  endsAtIso: string,
  venueName: string,
  description: string
): void {
  const start = new Date(startsAtIso).toISOString().replace(/-|:|\.\d+/g, "");
  const end = new Date(endsAtIso).toISOString().replace(/-|:|\.\d+/g, "");

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GowTrain//NONSGML v1.0//EN",
    "BEGIN:VEVENT",
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${venueName}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.setAttribute("download", "gowtrain-les.ics");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
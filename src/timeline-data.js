/**
 * Timeline data. The river runs from START to END, and the boat's position
 * and every marker are placed by date between those two.
 * Dates are local time. Rename the titles to the real event names.
 */
export const START = "2026-10-01T00:00:00"; // announcement = start of the river
export const END = "2026-12-01T00:00:00"; // showdown = end of the river

export const events = [
  { date: "2026-10-01", title: "Announcement" },
  { date: "2026-10-15", title: "Event 1" },
  { date: "2026-11-02", title: "Event 2" },
  { date: "2026-11-20", title: "Event 3" },
  { date: "2026-12-01", title: "Showdown" },
];

/**
 * Places event markers + labels along the river by date.
 * Works with the `river` object from river.js (uses river.pointAt).
 * Markers are plain DOM, so they are accessible, selectable and easy to style.
 */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const toTime = (day) => Date.parse(`${day}T00:00:00`);

export function createEvents(list, items, { start, end }) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  const fmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

  const nodes = items.map((it) => {
    const li = document.createElement("li");
    li.className = "event";

    const dot = document.createElement("span");
    dot.className = "event__dot";

    const label = document.createElement("div");
    label.className = "event__label";
    const time = document.createElement("time");
    time.className = "event__date";
    time.dateTime = it.date;
    time.textContent = fmt.format(new Date(toTime(it.date)));
    const title = document.createElement("h3");
    title.className = "event__title";
    title.textContent = it.title;

    label.append(time, title);
    li.append(dot, label);
    list.append(li);
    return {
      li,
      label,
      time: toTime(it.date),
      t: clamp((toTime(it.date) - s) / (e - s), 0, 1),
    };
  });

  /** past / next styling (called on layout and once a minute) */
  function update() {
    const now = Date.now();
    let nextDone = false;
    for (const n of nodes) {
      const past = n.time <= now;
      n.li.classList.toggle("is-past", past);
      const isNext = !past && !nextDone;
      if (isNext) nextDone = true;
      n.li.classList.toggle("is-next", isNext);
    }
  }

  /** (re)position everything; pass the river api (river.js calls this via onLayout) */
  function layout(river) {
    if (!river) return;
    const style = getComputedStyle(list);
    const half =
      (parseFloat(style.getPropertyValue("--river-width")) || 56) / 2 +
      (parseFloat(style.getPropertyValue("--river-bank-width")) || 10);
    const boat = parseFloat(style.getPropertyValue("--boat-size")) || 64;
    const off = Math.max(half, boat / 2) + 10; // clear of both the bank and the boat
    const W = list.clientWidth;
    const H = list.clientHeight;

    for (const n of nodes) {
      const { x, y, angle } = river.pointAt(n.t);
      // flowing mostly sideways -> label above/below; mostly up/down -> label left/right
      const sideways = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle));
      const side = sideways
        ? y > H / 2
          ? "top"
          : "bottom"
        : x > W / 2
          ? "left"
          : "right";

      let room;
      if (side === "right") room = W - x - off - 12;
      else if (side === "left") room = x - off - 12;
      else room = Math.min(x, W - x) * 2 - 24;

      n.li.dataset.side = side;
      n.li.style.setProperty("--off", `${off}px`);
      n.li.style.left = `${x}px`;
      n.li.style.top = `${y}px`;
      n.label.style.maxWidth = `${Math.max(80, Math.min(room, 180))}px`;
    }
    update();
  }

  setInterval(update, 60000);
  return { layout, update };
}

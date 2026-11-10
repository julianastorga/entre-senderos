import { WORKSHOP_ACCENTS, sessionDates, parseDate, formatDate, formatSchedule, formatCadence, enrollmentOpen } from "./workshops.mjs";
import { editionSignup, newsletterInvitation } from "./enrollment-view.mjs";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function createCalendar() {
  const grid = document.querySelector("#calendar-grid");
  if (!grid) return null;
  const heading = document.querySelector("#calendar-month");
  const filter = document.querySelector("#course-filter");
  const previous = document.querySelector("[data-calendar-prev]");
  const next = document.querySelector("[data-calendar-next]");
  const summary = document.querySelector("#calendar-month-summary");
  const announcement = document.querySelector("#calendar-announcement");
  const agenda = document.querySelector("#day-agenda");
  const agendaTitle = document.querySelector("#day-agenda-title");
  const agendaList = document.querySelector("#day-agenda-list");
  const list = document.querySelector("[data-schedule-list]");
  const monthFormatter = new Intl.DateTimeFormat("es-419", { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdays = [["L", "lunes"], ["M", "martes"], ["M", "miércoles"], ["J", "jueves"], ["V", "viernes"], ["S", "sábado"], ["D", "domingo"]];
  let workshops = [];
  let visibleMonth = null;
  let selectedDate = null;
  previous.disabled = true;
  next.disabled = true;
  filter.disabled = true;

  function eventsForSelection() {
    return workshops.filter((workshop) => filter.value === "all" || workshop.id === filter.value).flatMap((workshop) =>
      sessionDates(workshop).map((date, index) => {
        const boundary = workshop.sessions === 1 ? "Inicio y cierre" : index === 0 ? "Inicio" : index === workshop.sessions - 1 ? "Cierre" : "Encuentro";
        return { date, workshop, label: `${workshop.name} (${workshop.code}) · ${boundary} · ${index + 1}/${workshop.sessions} · ${formatSchedule(workshop)}` };
      })
    );
  }

  function showAgenda(events, focus = false) {
    const selected = events.filter((event) => event.date === selectedDate);
    agenda.hidden = !selected.length;
    agendaList.replaceChildren();
    if (!selected.length) return;
    agendaTitle.textContent = formatDate(selectedDate);
    selected.forEach((event) => {
      const item = element("li");
      if (enrollmentOpen(event.workshop)) item.append(editionSignup(event.workshop, { label: event.label, className: "text-link" }));
      else item.append(element("p", event.label), newsletterInvitation());
      agendaList.append(item);
    });
    if (focus) agendaTitle.focus();
  }

  function render(announce = false) {
    const year = visibleMonth.getUTCFullYear();
    const month = visibleMonth.getUTCMonth();
    const monthName = monthFormatter.format(visibleMonth);
    heading.textContent = monthName;
    previous.disabled = year === 1 && month === 0;
    next.disabled = year === 9999 && month === 11;
    const events = eventsForSelection();
    const table = element("table", undefined, "calendar-table");
    table.append(element("caption", `Encuentros de ${monthName}`, "sr-only"));
    const headRow = table.createTHead().insertRow();
    weekdays.forEach(([shortName, fullName]) => {
      const cell = element("th");
      cell.scope = "col";
      const abbreviation = element("abbr", shortName);
      abbreviation.title = fullName;
      cell.append(abbreviation);
      headRow.append(cell);
    });
    const body = table.createTBody();
    const offset = (visibleMonth.getUTCDay() + 6) % 7;
    const lastDay = new Date(visibleMonth);
    lastDay.setUTCMonth(month + 1, 0);
    const daysInMonth = lastDay.getUTCDate();
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
    let row;
    let monthlyEvents = 0;
    for (let index = 0; index < totalCells; index += 1) {
      if (index % 7 === 0) row = body.insertRow();
      const cell = row.insertCell();
      const day = index - offset + 1;
      if (day < 1 || day > daysInMonth) continue;
      const dateString = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayEvents = events.filter((event) => event.date === dateString);
      const time = element("time", String(day));
      time.dateTime = dateString;
      if (!dayEvents.length) {
        cell.append(time);
        continue;
      }
      monthlyEvents += dayEvents.length;
      const button = element("button", undefined, "calendar-event");
      button.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[dayEvents[0].workshop.accent].color);
      button.type = "button";
      button.setAttribute("aria-controls", "day-agenda");
      button.setAttribute("aria-pressed", String(selectedDate === dateString));
      const count = element("span", String(dayEvents.length), "event-count");
      const description = element("span", ` ${dayEvents.length === 1 ? "taller" : "talleres"}. ${formatDate(dateString)}: ${dayEvents.map((event) => event.label).join(". ")}`, "sr-only");
      const accents = element("span", undefined, "calendar-accents");
      accents.setAttribute("aria-hidden", "true");
      dayEvents.forEach((event) => {
        const dot = element("i");
        dot.style.backgroundColor = WORKSHOP_ACCENTS[event.workshop.accent].color;
        accents.append(dot);
      });
      button.append(time, document.createTextNode(" "), count, accents, description);
      button.addEventListener("click", () => {
        selectedDate = selectedDate === dateString ? null : dateString;
        grid.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button && selectedDate !== null)));
        showAgenda(events, selectedDate !== null);
      });
      cell.append(button);
    }
    grid.replaceChildren(table);
    summary.textContent = monthlyEvents
      ? `${monthlyEvents} encuentros este mes. Selecciona un día marcado para ver sus talleres, códigos y si corresponde al inicio o al cierre.`
      : "No hay encuentros de los talleres seleccionados en este mes.";
    showAgenda(events.filter((event) => event.date.startsWith(`${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`)));
    list.replaceChildren();
    workshops.filter((workshop) => filter.value === "all" || workshop.id === filter.value).forEach((workshop) => {
      const dates = sessionDates(workshop);
      const card = element("article", undefined, "schedule-card");
      card.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[workshop.accent].color);
      card.dataset.scheduleCourse = workshop.id;
      card.append(element("p", workshop.code, "eyebrow"), element("h3", workshop.name));
      const details = element("dl");
      for (const [label, date] of [["Inicio", dates[0]], ["Cierre", dates.at(-1)]]) {
        const detail = element("div");
        const value = element("dd");
        const time = element("time", formatDate(date));
        time.dateTime = date;
        value.append(time);
        detail.append(element("dt", label), value);
        details.append(detail);
      }
      card.append(details, element("p", `${formatCadence(workshop)} · ${workshop.sessions} encuentros`),
        element("p", formatSchedule(workshop)), editionSignup(workshop, { label: "Ver formulario de inscripción", className: "text-link" }));
      list.append(card);
    });
    if (!workshops.length) list.append(element("p", "No hay talleres disponibles.", "empty-state"));
    if (announce) announcement.textContent = `${monthName}. ${summary.textContent}`;
  }

  previous.addEventListener("click", () => {
    visibleMonth.setUTCMonth(visibleMonth.getUTCMonth() - 1);
    selectedDate = null;
    render(true);
  });
  next.addEventListener("click", () => {
    visibleMonth.setUTCMonth(visibleMonth.getUTCMonth() + 1);
    selectedDate = null;
    render(true);
  });
  filter.addEventListener("change", () => {
    const workshop = workshops.find((item) => item.id === filter.value);
    if (workshop) {
      visibleMonth = parseDate(workshop.startDate);
      visibleMonth.setUTCDate(1);
    }
    selectedDate = null;
    render(true);
  });

  return {
    unavailable() {
      previous.disabled = true;
      next.disabled = true;
      filter.disabled = true;
      heading.textContent = "Calendario no disponible";
      summary.textContent = "No se pudo cargar el calendario. Revisa la conexión y vuelve a intentarlo.";
      grid.replaceChildren();
      list.replaceChildren();
      agenda.hidden = true;
    },
    update(updated) {
      filter.disabled = false;
      workshops = updated;
      const selection = filter.value;
      filter.replaceChildren(new Option("Todos los talleres", "all"));
      workshops.forEach((workshop) => filter.add(new Option(`${workshop.code} · ${workshop.name}`, workshop.id)));
      filter.value = workshops.some((workshop) => workshop.id === selection) ? selection : "all";
      if (!visibleMonth) {
        const dates = workshops.flatMap(sessionDates).sort();
        const today = new Date().toISOString().slice(0, 10);
        visibleMonth = parseDate(dates.find((date) => date >= today) || dates[0] || today);
        visibleMonth.setUTCDate(1);
      }
      render();
    },
  };
}

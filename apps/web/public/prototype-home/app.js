// Throwaway native-home visual exploration. All readings and actions are simulated.
// Three compositions on one route, switched by ?variant=A/B/C. No persistence or real mutations.
const $ = (id) => document.getElementById(id);
const state = {
  lights: { lamps: true, kitchen: false, bedroom: true },
  colors: { lamps: "#ffc693", bedroom: "#9ab6f2" },
  names: { lamps: "Warm white", bedroom: "Soft blue" },
  brightness: { lamps: 80, bedroom: 65 },
  target: 73,
  heat: 68,
  mode: "cool",
  fan: true,
  source: "desk",
  volume: 50,
  rooms: { "Living room": 50, Bedroom: 75, Desk: 50 },
  balance: { "Living room": 1, Bedroom: 1.5, Desk: 1 },
};
let activeLight = "lamps",
  hue = 30,
  toastTimer;
const saved = [
  { name: "Warm white", color: "#ffc693" },
  { name: "Red", color: "#eb5957" },
  { name: "Blue", color: "#9ab6f2" },
];
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function updateLights() {
  for (const key of Object.keys(state.lights)) {
    const tile = $(`${key}Tile`);
    tile.classList.toggle("is-off", !state.lights[key]);
    tile.querySelector("[data-light]").setAttribute("aria-pressed", state.lights[key]);
    $(`${key}State`).textContent = state.lights[key]
      ? `On${key === "kitchen" ? "" : ` · ${state.names[key]}`}`
      : "Off";
    if (key !== "kitchen") {
      tile.style.setProperty("--light-color", state.colors[key]);
      const art = tile.querySelector(".beam,.bedroom-art");
      art.style.background =
        key === "lamps"
          ? `conic-gradient(from 145deg at 66% 0%,transparent 0deg,${state.colors[key]} 28deg,transparent 64deg)`
          : `radial-gradient(circle at 35% 35%,${state.colors[key]},#555d78 55%,#3a3f52 70%)`;
      art.style.opacity = state.lights[key] ? state.brightness[key] / 100 : 0.08;
    }
  }
}
document.querySelectorAll("[data-light]").forEach((b) => {
  b.addEventListener("click", () => {
    const key = b.dataset.light;
    state.lights[key] = !state.lights[key];
    if (key === "lamps") state.lights.bedroom = state.lights.lamps;
    updateLights();
  });
});
function setColor(color, name) {
  state.colors[activeLight] = color;
  state.names[activeLight] = name;
  state.lights[activeLight] = true;
  if (activeLight === "lamps") {
    state.colors.bedroom = color;
    state.names.bedroom = name;
    state.lights.bedroom = true;
  }
  $("colorRoom").style.setProperty("--color", color);
  $("colorName").textContent = name;
  updateLights();
}
function renderSaved() {
  $("savedColors").replaceChildren();
  saved.forEach((s, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "saved-item";
    const choose = document.createElement("button");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = s.color;
    choose.append(swatch, document.createTextNode(s.name));
    choose.addEventListener("click", () => setColor(s.color, s.name));
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${s.name}`);
    remove.addEventListener("click", () => {
      saved.splice(index, 1);
      renderSaved();
    });
    wrapper.append(choose, remove);
    $("savedColors").append(wrapper);
  });
}
document.querySelectorAll("[data-color]").forEach((b) => {
  b.addEventListener("click", () => {
    activeLight = b.dataset.color;
    $("colorTitle").textContent = activeLight === "lamps" ? "All lamps" : "Bedroom";
    $("brightness").value = state.brightness[activeLight];
    $("brightnessValue").textContent = `${state.brightness[activeLight]}%`;
    $("colorRoom").style.setProperty("--color", state.colors[activeLight]);
    $("colorName").textContent = state.names[activeLight];
    renderSaved();
    $("colorDialog").showModal();
  });
});
function applyHue() {
  const color = `hsl(${hue} 80% 68%)`;
  $("wheelMarker").style.transform = `rotate(${hue}deg)`;
  $("colorWheel").setAttribute("aria-valuenow", hue);
  setColor(color, "Custom color");
}
function pointerColor(event) {
  const r = $("colorWheel").getBoundingClientRect();
  hue = Math.round(
    ((Math.atan2(event.clientY - r.top - r.height / 2, event.clientX - r.left - r.width / 2) *
      180) /
      Math.PI +
      90 +
      360) %
      360,
  );
  applyHue();
}
$("colorWheel").addEventListener("pointerdown", (event) => {
  event.currentTarget.setPointerCapture(event.pointerId);
  pointerColor(event);
});
$("colorWheel").addEventListener("pointermove", (event) => {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) pointerColor(event);
});
$("colorWheel").addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    hue = (hue + (["ArrowRight", "ArrowUp"].includes(event.key) ? 5 : 355)) % 360;
    applyHue();
  }
});
$("brightness").addEventListener("input", (event) => {
  state.brightness[activeLight] = +event.target.value;
  $("brightnessValue").textContent = `${event.target.value}%`;
  updateLights();
});
$("saveColor").addEventListener("click", () => {
  const name =
    state.names[activeLight] === "Custom color"
      ? `Color ${saved.length + 1}`
      : state.names[activeLight];
  saved.push({ name, color: state.colors[activeLight] });
  renderSaved();
  toast("Color saved for this preview");
});
function climate() {
  const mode = state.mode;
  const off = mode === "off";
  $("climateStatus").textContent = {
    cool: "Cooling",
    heat: "Heating",
    auto: "Auto comfort",
    off: "System off",
  }[mode];
  $("target").textContent = off
    ? "Off"
    : mode === "auto"
      ? `${state.heat}–${state.target}°`
      : `${state.target}°`;
  $("targetDescription").textContent = off
    ? "Taking a break."
    : mode === "heat"
      ? "A little warmer."
      : mode === "auto"
        ? "Your comfort range."
        : "A little cooler.";
  $("decrease").disabled = off || state.target <= (mode === "auto" ? state.heat + 1 : 50);
  $("increase").disabled = off || state.target >= 90;
  $("autoTarget").hidden = mode !== "auto";
  $("coolTarget").value = state.target;
  $("heatTarget").value = state.heat;
  $("fanState").textContent = state.fan ? "on" : "auto";
  $("fan").setAttribute("aria-pressed", state.fan);
  $("climateTile").style.setProperty("--thermal", mode === "heat" ? "#a86347" : "#527c70");
  document.querySelector(".dial-marker").style.transform = `rotate(${(state.target - 73) * 5}deg)`;
}
$("mode").addEventListener("change", (e) => {
  state.mode = e.target.value;
  climate();
});
$("decrease").addEventListener("click", () => {
  state.target = Math.max(state.mode === "auto" ? state.heat + 1 : 50, state.target - 1);
  climate();
});
$("increase").addEventListener("click", () => {
  state.target = Math.min(90, state.target + 1);
  climate();
});
$("heatTarget").addEventListener("change", (e) => {
  state.heat = Math.max(50, Math.min(state.target - 1, Number(e.target.value) || 68));
  climate();
});
$("coolTarget").addEventListener("change", (e) => {
  state.target = Math.min(90, Math.max(state.heat + 1, Number(e.target.value) || 73));
  climate();
});
$("fan").addEventListener("click", () => {
  state.fan = !state.fan;
  climate();
});
function sources() {
  document.querySelectorAll("[data-source]").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.source === state.source);
  });
  $("sourceTitle").textContent = {
    desk: "Desk → everywhere",
    tv: "TV → everywhere",
    "tv-only": "Just the living room",
  }[state.source];
  $("sourceSubtitle").textContent =
    state.source === "tv-only" ? "TV audio. Other rooms stay separate." : "All rooms, one sound.";
}
document.querySelectorAll("[data-source]").forEach((b) => {
  b.addEventListener("click", () => {
    state.source = b.dataset.source;
    sources();
  });
});
function updateVolume() {
  $("volumeValue").innerHTML = `${state.volume}<span>%</span>`;
  $("volume").style.setProperty("--fill", `${state.volume}%`);
}
$("volume").addEventListener("input", (e) => {
  state.volume = +e.target.value;
  const rooms = state.source === "tv-only" ? ["Living room"] : Object.keys(state.rooms);
  for (const room of rooms)
    state.rooms[room] = Math.min(100, Math.round(state.volume * state.balance[room]));
  updateVolume();
});
function renderRooms() {
  $("roomSliders").replaceChildren();
  Object.entries(state.rooms).forEach(([name, value]) => {
    const row = document.createElement("div");
    row.className = "room-row";
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = `${value}%`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = value;
    input.id = `room-${name.replaceAll(" ", "-")}`;
    label.htmlFor = input.id;
    label.append(document.createTextNode(name), text);
    input.style.setProperty("--fill", `${value}%`);
    input.addEventListener("input", () => {
      state.rooms[name] = +input.value;
      text.textContent = `${input.value}%`;
      input.style.setProperty("--fill", `${input.value}%`);
    });
    row.append(label, input);
    $("roomSliders").append(row);
  });
}
$("balanceOpen").addEventListener("click", () => {
  renderRooms();
  $("balanceDialog").showModal();
});
$("saveBalance").addEventListener("click", () => {
  if (!state.volume) {
    toast("Raise master volume before saving a balance");
    return;
  }
  for (const room in state.rooms) state.balance[room] = state.rooms[room] / state.volume;
  $("balanceNote").textContent =
    "Saved. Master volume now keeps this balance (up to 100% per speaker).";
  toast("Your room balance is saved");
});
$("resetBalance").addEventListener("click", () => {
  for (const room in state.rooms) {
    state.balance[room] = 1;
    state.rooms[room] = state.volume;
  }
  renderRooms();
  $("balanceNote").textContent = "All speakers at the same volume.";
});
document.querySelectorAll("[data-close]").forEach((b) => {
  b.addEventListener("click", () => b.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        d.close();
    }
  });
});
const temps = [72, 74, 76, 77, 78, 77, 75, 72, 69, 67, 65, 64],
  feels = [74, 76, 78, 80, 81, 79, 77, 74, 70, 67, 65, 64];
function weather() {
  const host = $("weatherGraph");
  const width = host.clientWidth,
    height = host.clientHeight;
  if (!width) return;
  const x = (i) => 10 + (i * (width - 20)) / 11,
    y = (t) => height - 22 - ((t - 60) / (85 - 60)) * (height - 24);
  const path = (values) =>
    values.map((v, i) => `${(i ? "L" : "M") + x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const labels = [0, 2, 4, 6, 8, 11]
    .map(
      (i) =>
        `<text x="${x(i)}" y="${height - 1}" text-anchor="${i === 0 ? "start" : i === 11 ? "end" : "middle"}" fill="#fff3e3" font-size="9">${i === 0 ? "Now" : ((10 + i) % 12 || 12) + (10 + i >= 12 ? "pm" : "am")}</text>`,
    )
    .join("");
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Illustrative 12-hour forecast. Temperature rises from 72 to 78 degrees then cools to 64. Feels-like peaks at 81."><path d="M 10 ${y(70)} H ${width - 10}" stroke="#ffffff20" fill="none"/><path d="${path(feels)}" fill="none" stroke="#ffe6cb" stroke-width="1.5" stroke-dasharray="3 4"/><path d="${path(temps)}" fill="none" stroke="#fff4db" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${labels}<circle id="weatherDot" cx="${x(0)}" cy="${y(temps[0])}" r="4" fill="#fff1cf"/></svg>`;
  host.onpointerdown = host.onpointermove = (e) => {
    if (e.type === "pointermove" && e.pointerType === "touch" && !e.buttons) return;
    const index = Math.max(
      0,
      Math.min(
        11,
        Math.round(((e.clientX - host.getBoundingClientRect().left - 10) / (width - 20)) * 11),
      ),
    );
    $("weatherReadout").textContent =
      `${index ? `+${index}h` : "Now"} · ${temps[index]}° / feels ${feels[index]}°`;
    $("weatherDot").setAttribute("cx", x(index));
    $("weatherDot").setAttribute("cy", y(temps[index]));
  };
}
new ResizeObserver(weather).observe($("weatherGraph"));
const variants = ["A", "B", "C"];
let variant = new URLSearchParams(location.search).get("variant") || "A";
if (!variants.includes(variant)) variant = "A";
function switchVariant(next) {
  variant = next;
  document.body.dataset.variant = variant;
  const url = new URL(location);
  url.searchParams.set("variant", variant);
  history.replaceState({}, "", url);
  document.querySelectorAll("[data-variant]").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.variant === variant);
  });
  $("designCaption").textContent = {
    A: "01 / AFTERGLOW · A home with a pulse.",
    B: "02 / DAYBREAK · Let a little light in.",
    C: "03 / LISTENING ROOM · Sound takes center stage.",
  }[variant];
}
document.querySelectorAll("button[data-variant]").forEach((b) => {
  b.addEventListener("click", () => switchVariant(b.dataset.variant));
});
function cycle(direction) {
  switchVariant(variants[(variants.indexOf(variant) + direction + 3) % 3]);
}
$("prevVariant").addEventListener("click", () => cycle(-1));
$("nextVariant").addEventListener("click", () => cycle(1));
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select,button,dialog,[contenteditable],[role=slider]"))
    return;
  if (e.key === "ArrowLeft") cycle(-1);
  if (e.key === "ArrowRight") cycle(1);
});
$("phonePreview").addEventListener("click", () => {
  const enabled = document.body.classList.toggle("phone-mode");
  $("phonePreview").setAttribute("aria-pressed", enabled);
  $("phonePreview").innerHTML = enabled
    ? "Back to wall <span>↗</span>"
    : "Phone preview <span>↗</span>";
});
function clock() {
  const now = new Date();
  $("clock").textContent = now
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\s[AP]M/, "");
  $("date").textContent = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
clock();
setInterval(clock, 30000);
switchVariant(variant);
climate();
updateLights();
sources();
updateVolume();

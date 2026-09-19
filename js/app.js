(() => {
  const DATA = window.VP_DATA;
  const WHEEL_KEYS = ["target", "shot", "brief"];
  const WHEEL_META = {
    target: { title: "TARGET", accent: "#ff2bd6", colors: ["#2a1024", "#4a1538"], list: DATA.targets },
    shot: { title: "SHOT", accent: "#00f0ff", colors: ["#062428", "#0b3d48"], list: DATA.shots },
    brief: { title: "BRIEF", accent: "#fcee0a", colors: ["#2a2608", "#4a420c"], list: DATA.briefs }
  };
  const CATEGORY_LABELS = {
    traitement: "LOOK",
    technique: "TECH",
    scene: "SCENE",
    format: "FORMAT"
  };

  const state = {
    difficulty: "street",
    locked: { target: false, shot: false, brief: false },
    result: { target: null, shot: null, brief: null, fixer: null },
    bonuses: [],
    contract: null,
    spinning: false,
    seed: null,
    muted: localStorage.getItem("vp-mute") === "1",
    rotations: { target: 0, shot: 0, brief: 0 },
    audio: null
  };

  const els = {
    diffSwitch: document.getElementById("diff-switch"),
    wheels: document.getElementById("wheels"),
    spinBtn: document.getElementById("spin-btn"),
    rerollBtn: document.getElementById("reroll-btn"),
    validateBtn: document.getElementById("validate-btn"),
    bonusList: document.getElementById("bonus-list"),
    fixerLine: document.getElementById("fixer-line"),
    muteBtn: document.getElementById("mute-btn"),
    toast: document.getElementById("toast"),
    cardTarget: document.getElementById("card-target"),
    cardShot: document.getElementById("card-shot"),
    cardBrief: document.getElementById("card-brief"),
    cardFixer: document.getElementById("card-fixer"),
    cardRows: document.getElementById("card-rows"),
    cardCode: document.getElementById("card-code")
  };

  function mulberry32(a) {
    return function rng() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedToCode(seed) {
    return "NC-" + (seed >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(-4);
  }

  function pick(list, rng, excludeIds = []) {
    const pool = list.filter((item) => !excludeIds.includes(item.id));
    if (!pool.length) return null;
    return pool[Math.floor(rng() * pool.length)];
  }

  function shuffle(list, rng) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function polar(cx, cy, r, deg) {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function piePath(cx, cy, r, start, end) {
    const s = polar(cx, cy, r, start);
    const e = polar(cx, cy, r, end);
    const large = end - start > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
  }

  function getAudio() {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audio.state === "suspended") state.audio.resume();
    return state.audio;
  }

  function beep(freq, duration, type = "square", gain = 0.04) {
    if (state.muted) return;
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start();
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("is-on"), 1800);
  }

  function currentDifficulty() {
    return DATA.difficulties.find((item) => item.id === state.difficulty);
  }

  function hasResult() {
    return WHEEL_KEYS.every((key) => state.result[key]);
  }

  function categoryTaken(category) {
    return state.bonuses.some((bonus) => bonus.category === category);
  }

  function syncBonusButtons() {
    document.querySelectorAll("[data-bonus]").forEach((btn) => {
      btn.disabled = state.spinning || !hasResult() || categoryTaken(btn.dataset.bonus);
    });
  }

  function setSpinning(on) {
    state.spinning = on;
    els.spinBtn.disabled = on;
    els.rerollBtn.disabled = on || !hasResult();
    els.validateBtn.disabled = on || !hasResult();
    syncBonusButtons();
  }

  function renderDifficulty() {
    els.diffSwitch.innerHTML = DATA.difficulties.map((item) => `
      <button class="diff-btn cut ${item.id === state.difficulty ? "is-active" : ""}" data-diff="${item.id}" type="button">
        ${item.name}<small>${item.tag}</small>
      </button>
    `).join("");
  }

  function renderWheels() {
    els.wheels.innerHTML = WHEEL_KEYS.map((key) => {
      const meta = WHEEL_META[key];
      return `
        <article class="wheel-card" data-wheel="${key}" style="--wheel-accent:${meta.accent}">
          <h2>${meta.title}</h2>
          <div class="wheel-stage">
            <div class="wheel-pointer" aria-hidden="true"></div>
            <svg class="wheel-svg" id="svg-${key}" viewBox="0 0 200 200" role="img" aria-label="${meta.title} wheel"></svg>
            <div class="wheel-hub"><span>${meta.title}</span></div>
          </div>
          <div class="plaque" id="plaque-${key}">
            <span class="placeholder">/// STANDBY</span>
          </div>
          <button class="lock-btn" data-lock="${key}" type="button">Lock</button>
        </article>
      `;
    }).join("");

    WHEEL_KEYS.forEach((key) => paintWheel(key, shuffle(WHEEL_META[key].list, Math.random).slice(0, 10)));
  }

  function paintWheel(key, segments) {
    const svg = document.getElementById(`svg-${key}`);
    const meta = WHEEL_META[key];
    const cx = 100;
    const cy = 100;
    const r = 98;
    const arc = 360 / segments.length;
    svg.innerHTML = segments.map((item, index) => {
      const start = index * arc;
      const end = start + arc;
      const fill = meta.colors[index % 2];
      const mid = start + arc / 2;
      const textPos = polar(cx, cy, 68, mid);
      const rotate = mid;
      return `
        <path d="${piePath(cx, cy, r, start, end)}" fill="${fill}" stroke="${meta.accent}" stroke-width="0.9"></path>
        <text x="${textPos.x}" y="${textPos.y}" fill="#f7f4ea" font-size="7.4" font-family="Share Tech Mono, monospace"
          font-weight="700" text-anchor="middle" dominant-baseline="middle"
          stroke="#07070c" stroke-width="3" paint-order="stroke"
          transform="rotate(${rotate} ${textPos.x} ${textPos.y})">${item.short}</text>
      `;
    }).join("");
    svg.dataset.segments = JSON.stringify(segments.map((item) => item.id));
  }

  function updatePlaque(key, item) {
    const plaque = document.getElementById(`plaque-${key}`);
    plaque.innerHTML = item
      ? `<strong>${item.label}</strong>`
      : `<span class="placeholder">/// STANDBY</span>`;
  }

  function updateLockButtons() {
    document.querySelectorAll("[data-lock]").forEach((btn) => {
      const key = btn.dataset.lock;
      const locked = state.locked[key];
      btn.classList.toggle("is-locked", locked);
      btn.textContent = locked ? "Locked" : "Lock";
    });
  }

  function renderBonuses() {
    if (!state.bonuses.length) {
      els.bonusList.innerHTML = "";
      syncBonusButtons();
      return;
    }
    els.bonusList.innerHTML = state.bonuses.map((bonus, index) => `
      <div class="bonus-chip">
        <b>${CATEGORY_LABELS[bonus.category]}</b>
        <span>${bonus.item.label}</span>
        <em>${formatEddies(bonus.item.eddies)}</em>
        <button type="button" data-remove-bonus="${index}" aria-label="Remove this bonus">×</button>
      </div>
    `).join("");
    syncBonusButtons();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatNCDate(date) {
    return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}  ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  }

  function formatEddies(amount) {
    return "€$ " + amount.toLocaleString("en-US");
  }

  function payoutEddies() {
    const base = { street: 4800, nomad: 9600, corpo: 16800, legend: 28400 }[state.difficulty];
    const noise = state.seed ? (state.seed % 19) * 100 : 0;
    const spice = state.bonuses.reduce((sum, bonus) => sum + (bonus.item.eddies || 0), 0);
    return base + noise + spice;
  }

  function createContract(rng) {
    const issued = new Date(Date.UTC(
      2077,
      Math.floor(rng() * 12),
      1 + Math.floor(rng() * 28),
      Math.floor(rng() * 24),
      [0, 7, 13, 21, 37, 44, 52][Math.floor(rng() * 7)]
    ));
    const hours = [12, 24, 36, 48, 72][Math.floor(rng() * 5)];
    return {
      issued,
      deadline: new Date(issued.getTime() + hours * 36e5),
      hours,
      eddies: payoutEddies()
    };
  }

  function syncContract() {
    if (!state.contract) return;
    state.contract.eddies = payoutEddies();
    renderFixer();
  }

  function contractMarkup(compact) {
    const fixer = state.result.fixer;
    const job = state.contract;
    const extraClass = compact ? " contract--card" : "";
    return `
      <article class="contract${extraClass}">
        <header class="contract-head">
          <span>Gig contract</span>
          <span>Classified</span>
        </header>
        <div class="contract-body">
          <img src="${fixer.image}" alt="${fixer.name}">
          <div class="contract-copy">
            <span class="contract-kicker">Issued by</span>
            <strong>${fixer.name}</strong>
            <p>${fixer.quote}</p>
          </div>
        </div>
        <dl class="contract-meta">
          <div>
            <dt>Issued</dt>
            <dd>${formatNCDate(job.issued)}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>${job.hours} hours</dd>
            <dd class="sub">${formatNCDate(job.deadline)}</dd>
          </div>
          <div>
            <dt>Payout</dt>
            <dd class="pay">${formatEddies(job.eddies)}</dd>
          </div>
        </dl>
        <footer class="contract-foot">Client copy // ${seedToCode(state.seed)}</footer>
      </article>
    `;
  }

  function renderFixer() {
    if (!state.result.fixer || !state.contract) {
      els.fixerLine.hidden = true;
      return;
    }
    els.fixerLine.hidden = false;
    els.fixerLine.innerHTML = contractMarkup(false);
  }

  function spinWheel(key, winner, rng) {
    return new Promise((resolve) => {
      const list = WHEEL_META[key].list;
      const count = Math.min(10, list.length);
      const others = shuffle(list.filter((item) => item.id !== winner.id), rng);
      const segments = shuffle([winner, ...others].slice(0, count), rng);
      const winnerIndex = segments.findIndex((item) => item.id === winner.id);
      paintWheel(key, segments);

      const svg = document.getElementById(`svg-${key}`);
      const arc = 360 / segments.length;
      const extraTurns = 5 + Math.floor(rng() * 3);
      const target = extraTurns * 360 + (360 - (winnerIndex + 0.5) * arc);
      const start = state.rotations[key] % 360;
      const dest = state.rotations[key] - start + target;
      const duration = 3800 + WHEEL_KEYS.indexOf(key) * 280;

      svg.style.transition = "none";
      svg.style.transform = `rotate(${state.rotations[key]}deg)`;
      void svg.getBoundingClientRect();
      svg.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.62, 0.08, 1)`;
      svg.style.transform = `rotate(${dest}deg)`;
      state.rotations[key] = dest;

      window.setTimeout(() => {
        updatePlaque(key, winner);
        beep(180 + WHEEL_KEYS.indexOf(key) * 90, 0.18, "sawtooth", 0.05);
        resolve();
      }, duration);
    });
  }

  function ensureFixer(rng) {
    if (!state.result.fixer) state.result.fixer = pick(DATA.fixers, rng);
    if (!state.contract) state.contract = createContract(rng);
  }

  function fillDifficultyBonuses(rng) {
    const categories = ["traitement", "technique", "scene", "format"];
    const needed = Math.min(currentDifficulty().bonuses, categories.length);
    let guard = 0;
    while (state.bonuses.length < needed && guard < 12) {
      guard += 1;
      const catPool = categories.filter((cat) => !categoryTaken(cat));
      if (!catPool.length) break;
      const category = catPool[Math.floor(rng() * catPool.length)];
      if (!addBonus(category, rng, false)) break;
    }
    renderBonuses();
  }

  function addBonus(category, rng, animate = true) {
    if (categoryTaken(category)) {
      toast("Already have a bonus in this category.");
      return false;
    }
    const roll = rng || Math.random;
    const used = state.bonuses.map((bonus) => bonus.item.id);
    const item = pick(DATA.bonuses[category], roll, used);
    if (!item) {
      toast("No bonuses left in this category.");
      return false;
    }
    state.bonuses.push({ category, item });
    renderBonuses();
    syncContract();
    if (animate) {
      const chip = els.bonusList.lastElementChild;
      if (chip) {
        const label = chip.querySelector("span");
        const pool = DATA.bonuses[category];
        const start = performance.now();
        const tick = (now) => {
          if (now - start > 700) {
            label.textContent = item.label;
            beep(520, 0.12, "square", 0.04);
            return;
          }
          label.textContent = pool[Math.floor(Math.random() * pool.length)].label;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }
    return true;
  }

  async function roll(unlockedOnly) {
    if (state.spinning) return;

    if (!unlockedOnly) {
      state.seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
      state.bonuses = [];
      state.result.fixer = null;
      state.contract = null;
      state.locked = { target: false, shot: false, brief: false };
      updateLockButtons();
      renderBonuses();
    } else if (!state.seed) {
      state.seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    }

    const keys = WHEEL_KEYS.filter((key) => !unlockedOnly || !state.locked[key]);
    if (!keys.length) {
      toast("Every wheel is locked.");
      return;
    }

    const rng = mulberry32(state.seed + (unlockedOnly ? 97 : 0) + (Date.now() % 97));
    setSpinning(true);
    beep(90, 0.25, "square", 0.05);

    await Promise.all(keys.map((key) => {
      const winner = pick(WHEEL_META[key].list, rng);
      state.result[key] = winner;
      return spinWheel(key, winner, rng);
    }));

    ensureFixer(rng);
    fillDifficultyBonuses(rng);
    syncContract();
    setSpinning(false);
    els.spinBtn.textContent = "New gig";
  }

  function fillCard() {
    els.cardTarget.textContent = state.result.target.label;
    els.cardShot.textContent = state.result.shot.label;
    els.cardBrief.textContent = state.result.brief.label;
    els.cardFixer.innerHTML = contractMarkup(true);
    els.cardCode.textContent = seedToCode(state.seed);
    els.cardRows.querySelectorAll(".card-row-bonus").forEach((row) => row.remove());
    if (state.bonuses.length) {
      els.cardRows.insertAdjacentHTML("beforeend", state.bonuses.map((bonus) => `
        <div class="card-row card-row-bonus">
          <span>${CATEGORY_LABELS[bonus.category]}</span>
          <strong>${bonus.item.label}</strong>
          <em>${formatEddies(bonus.item.eddies)}</em>
        </div>
      `).join(""));
    }
  }

  function discordBrief() {
    const lines = [
      `**PHOTO GIG**`,
      `Fixer: ${state.result.fixer.name}`,
      `Issued: ${formatNCDate(state.contract.issued)}`,
      `Deadline: ${state.contract.hours} hours (${formatNCDate(state.contract.deadline)})`,
      `Payout: ${formatEddies(state.contract.eddies)}`,
      `Target: ${state.result.target.label}`,
      `Shot: ${state.result.shot.label}`,
      `Brief: ${state.result.brief.label}`
    ];
    if (state.bonuses.length) {
      lines.push(`Bonus: ${state.bonuses.map((bonus) => `${bonus.item.label} (${formatEddies(bonus.item.eddies)})`).join(" · ")}`);
    }
    lines.push(`Code: ${seedToCode(state.seed)}`);
    return lines.join("\n");
  }

  async function saveGigImage() {
    const card = document.getElementById("gig-card");
    const btn = document.getElementById("save-btn");
    if (!card || !window.htmlToImage) {
      toast("Could not save image.");
      return;
    }
    const previous = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving...";
    card.classList.add("is-capturing");
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all([
        document.fonts.load('700 24px Orbitron'),
        document.fonts.load('800 24px Orbitron'),
        document.fonts.load('700 20px Rajdhani'),
        document.fonts.load('400 16px "Share Tech Mono"')
      ]);
      const fontEmbedCSS = await fetch("fonts/faces.css").then((res) => res.text());
      const dataUrl = await htmlToImage.toPng(card, {
        pixelRatio: 2,
        cacheBust: true,
        fontEmbedCSS,
        skipFonts: true,
        backgroundColor: "#07070c",
        style: {
          clipPath: "none",
          transform: "none"
        }
      });
      const link = document.createElement("a");
      link.download = `photo-gig-${seedToCode(state.seed)}.png`;
      link.href = dataUrl;
      link.click();
      toast("Image saved.");
    } catch (error) {
      toast("Could not save image.");
    } finally {
      card.classList.remove("is-capturing");
      btn.disabled = false;
      btn.textContent = previous;
    }
  }

  function syncMute() {
    els.muteBtn.textContent = state.muted ? "Sound OFF" : "Sound ON";
    els.muteBtn.setAttribute("aria-pressed", state.muted ? "true" : "false");
  }

  function init() {
    renderDifficulty();
    renderWheels();
    syncMute();
    setSpinning(false);
    els.validateBtn.disabled = true;
    els.rerollBtn.disabled = true;
    document.querySelectorAll("[data-bonus]").forEach((btn) => {
      btn.disabled = true;
    });

    els.diffSwitch.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-diff]");
      if (!btn || state.spinning) return;
      state.difficulty = btn.dataset.diff;
      renderDifficulty();
      if (hasResult()) {
        fillDifficultyBonuses(mulberry32((state.seed || 1) + 13));
        syncContract();
      }
    });

    els.wheels.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-lock]");
      if (!btn) return;
      const key = btn.dataset.lock;
      state.locked[key] = !state.locked[key];
      updateLockButtons();
    });

    els.spinBtn.addEventListener("click", () => roll(false));
    els.rerollBtn.addEventListener("click", () => roll(true));

    document.getElementById("bonuses-panel").addEventListener("click", (event) => {
      const add = event.target.closest("[data-bonus]");
      const remove = event.target.closest("[data-remove-bonus]");
      if (add && hasResult() && !state.spinning) {
        addBonus(add.dataset.bonus, Math.random);
      }
      if (remove) {
        state.bonuses.splice(Number(remove.dataset.removeBonus), 1);
        renderBonuses();
        syncContract();
      }
    });

    els.validateBtn.addEventListener("click", () => {
      if (!hasResult()) return;
      fillCard();
      document.body.classList.add("show-card");
    });

    document.getElementById("back-btn").addEventListener("click", () => {
      document.body.classList.remove("show-card");
    });

    document.getElementById("copy-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(discordBrief());
        toast("Brief copied.");
      } catch (error) {
        toast("Could not copy.");
      }
    });

    document.getElementById("save-btn").addEventListener("click", () => saveGigImage());

    els.muteBtn.addEventListener("click", () => {
      state.muted = !state.muted;
      localStorage.setItem("vp-mute", state.muted ? "1" : "0");
      syncMute();
    });

    document.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || event.repeat || event.target.matches("input")) return;
      event.preventDefault();
      if (!document.body.classList.contains("show-card")) roll(hasResult());
    });
  }

  init();
})();

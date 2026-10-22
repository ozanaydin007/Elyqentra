/* Elyqentra tracker. Accounts and data live in this browser's localStorage.
   To move to real server-side accounts later, replace the Store object with API calls. */
(() => {
  const D = window.RS_DATA, esc = RS.esc;
  const root = document.getElementById("app");
  const SPL = Object.fromEntries(D.splits.map(s => [s.slug, s]));
  const DIE = Object.fromEntries(D.diets.map(d => [d.slug, d]));
  const GOA = Object.fromEntries(D.goals.map(g => [g.id, g]));
  const FOOD = Object.fromEntries(D.foods.map(f => [f[0], f]));
  const params = new URLSearchParams(location.search);
  const wantSplit = SPL[params.get("split")] ? params.get("split") : null;
  const wantDiet = DIE[params.get("diet")] ? params.get("diet") : null;

  /* ---------- dates ---------- */
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const nice = s => parse(s).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  /* ---------- storage ---------- */
  const ls = {
    get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { } }
  };
  const Store = {
    users() { return ls.get("rs_users", {}); },
    session() { return ls.get("rs_session", null); },
    load(u) { return ls.get("rs_data_" + u, null); },
    save(u, d) { if (!ls.set("rs_data_" + u, d)) alert("Could not save. Your browser storage may be full or disabled."); }
  };

  async function hashPw(pw, salt) {
    if (!crypto || !crypto.subtle) throw new Error("Secure connection required. Open the site over https.");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const randSalt = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");

  let user = null, data = null;
  const save = () => Store.save(user, data);

  /* ---------- schedule engine ----------
     The plan advances only when a training day is marked done. Rest days pass automatically.
     A skipped or unlogged training day stays as the next day's session, pushing the whole cycle forward. */
  function schedule() {
    const s = SPL[data.plan.split], seq = s.sequence, L = seq.length, t = today();
    let pos = 0, d = data.plan.start; const past = [];
    while (d < t) {
      const key = seq[pos % L], plan = s.dayplans[key], log = data.log[d];
      if (plan.type === "rest") { past.push({ date: d, key, status: "rest" }); pos++; }
      else if (log && log.status === "done") { past.push({ date: d, key, status: "done" }); pos++; }
      else { past.push({ date: d, key, status: log && log.status === "skipped" ? "skipped" : "missed" }); }
      d = add(d, 1);
    }
    const tKey = seq[pos % L], tLog = data.log[t];
    const tStatus = s.dayplans[tKey].type === "rest" ? "rest" : tLog ? tLog.status : "pending";
    const upcoming = []; let p = tStatus === "skipped" ? pos : pos + 1;
    for (let i = 1; i <= 13; i++) { upcoming.push({ date: add(t, i), key: seq[p % L] }); p++; }
    return { split: s, today: { date: t, key: tKey, status: tStatus, pos }, past, upcoming };
  }

  /* ---------- rendering helpers ---------- */
  const h = (html) => { root.innerHTML = html; window.scrollTo(0, 0); };
  const choice = (val, title, sub, on, attr = "data-v") => `<button type="button" class="choice" ${attr}="${esc(val)}" aria-pressed="${on}"><strong>${esc(title)}</strong><span>${esc(sub)}</span></button>`;
  const fmtW = kg => data.profile.units === "metric" ? `${(+kg).toFixed(1)} kg` : `${(kg * 2.2046).toFixed(1)} lb`;
  const targets = () => RS.targets(data.profile, DIE[data.plan.diet], GOA[data.profile.goal]);

  /* ---------- auth ---------- */
  function renderAuth(mode) {
    const signup = mode === "signup";
    h(`<div class="auth card">
      <h1 style="font-size:2.4rem">${signup ? "Create your account" : "Log in"}</h1>
      <p class="muted">${signup ? "Free. Takes 30 seconds." : "Welcome back. Your plan is waiting."}</p>
      <form id="auth-f" novalidate>
        <div class="field"><label for="a-u">Username</label><input id="a-u" autocomplete="username" required minlength="3" maxlength="24"></div>
        <div class="field"><label for="a-p">Password</label><input id="a-p" type="password" autocomplete="${signup ? "new-password" : "current-password"}" required minlength="8"></div>
        ${signup ? `<div class="field"><label for="a-p2">Confirm password</label><input id="a-p2" type="password" autocomplete="new-password" required></div>` : ""}
        <p class="error" id="a-err" role="alert"></p>
        <button class="btn blue" style="width:100%">${signup ? "Create account" : "Log in"}</button>
      </form>
      <p class="small" style="margin-top:16px">${signup ? `Already have an account? <a href="#login">Log in</a>` : `New here? <a href="#signup">Create an account</a>`}</p>
      <p class="small muted">Your account and data are stored on this device only. Logging in from another browser or device starts a new account.</p>
    </div>`);
    document.getElementById("auth-f").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const u = document.getElementById("a-u").value.trim().toLowerCase(), p = document.getElementById("a-p").value;
      const err = document.getElementById("a-err"), users = Store.users();
      try {
        if (!/^[a-z0-9_.-]{3,24}$/.test(u)) return err.textContent = "Username must be 3-24 characters: letters, numbers, dot, dash or underscore.";
        if (signup) {
          if (p.length < 8) return err.textContent = "Password must be at least 8 characters.";
          if (p !== document.getElementById("a-p2").value) return err.textContent = "Passwords do not match.";
          if (users[u]) return err.textContent = "That username is taken on this device. Choose another or log in.";
          const salt = randSalt();
          users[u] = { salt, hash: await hashPw(p, salt), created: today() };
          ls.set("rs_users", users);
          Store.save(u, { profile: null, plan: null, log: {}, food: {}, weights: [] });
        } else {
          const rec = users[u];
          if (!rec || rec.hash !== await hashPw(p, rec.salt)) return err.textContent = "Username or password is incorrect.";
        }
        ls.set("rs_session", u); history.replaceState(null, "", location.pathname + location.search); start();
      } catch (e) { err.textContent = e.message; }
    });
  }

  /* ---------- onboarding ---------- */
  const ob = { step: 1, goal: null, units: "imperial", sex: "m", age: 28, kg: 79, cm: 178, act: 1.55, split: null, diet: null };
  function dots(n) { return `<div class="steps-dots" aria-label="Step ${n} of 3">${[1, 2, 3].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`; }
  function renderOnboarding() {
    if (ob.step === 1) {
      h(`<div class="card">${dots(1)}<h1 style="font-size:2.6rem">What's your goal?</h1><p class="muted">We'll set up your workout split and diet from your answer. You can change both later.</p>
        <div class="choices" id="goals">${D.goals.map(g => choice(g.id, g.name, g.desc, ob.goal === g.id)).join("")}</div></div>`);
      root.querySelectorAll("#goals .choice").forEach(b => b.addEventListener("click", () => {
        ob.goal = b.dataset.v; const g = GOA[ob.goal]; ob.split = wantSplit || g.split; ob.diet = wantDiet || g.diet; ob.step = 2; renderOnboarding();
      }));
    } else if (ob.step === 2) {
      const imp = ob.units === "imperial", totalIn = ob.cm / 2.54;
      h(`<div class="card">${dots(2)}<h1 style="font-size:2.6rem">About you</h1><p class="muted">Used to calculate your calories and macros.</p>
        <form id="ob2" novalidate>
        <div class="row"><div class="field"><label for="o-units">Units</label><select id="o-units"><option value="imperial" ${imp ? "selected" : ""}>Imperial (lb, ft/in)</option><option value="metric" ${!imp ? "selected" : ""}>Metric (kg, cm)</option></select></div>
        <div class="field"><label for="o-sex">Sex</label><select id="o-sex"><option value="m" ${ob.sex === "m" ? "selected" : ""}>Male</option><option value="f" ${ob.sex === "f" ? "selected" : ""}>Female</option></select></div>
        <div class="field"><label for="o-age">Age</label><input id="o-age" type="number" min="16" max="90" value="${ob.age}"></div></div>
        <div class="row"><div class="field"><label for="o-w">Weight (${imp ? "lb" : "kg"})</label><input id="o-w" type="number" step="0.1" value="${imp ? Math.round(ob.kg * 2.2046) : Math.round(ob.kg)}"></div>
        ${imp ? `<div class="field"><label for="o-ft">Height (ft)</label><input id="o-ft" type="number" value="${Math.floor(totalIn / 12)}"></div><div class="field"><label for="o-in">Height (in)</label><input id="o-in" type="number" value="${Math.round(totalIn % 12)}"></div>`
          : `<div class="field"><label for="o-cm">Height (cm)</label><input id="o-cm" type="number" value="${Math.round(ob.cm)}"></div>`}</div>
        <div class="field"><label for="o-act">Activity level, including training</label><select id="o-act">
          ${[[1.2, "Sedentary"], [1.375, "Light: training 1-3 days/week"], [1.55, "Moderate: training 3-5 days/week"], [1.725, "Very active: training 6-7 days/week"], [1.9, "Athlete: physical job plus hard training"]]
            .map(([v, l]) => `<option value="${v}" ${ob.act == v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <p class="small muted">You must be 16 or older to use the tracker.</p>
        <p class="error" id="o-err" role="alert"></p>
        <div class="actions"><button type="button" class="btn ghost" id="o-back">Back</button><button class="btn blue">Continue</button></div></form></div>`);
      const read = () => {
        const imp = document.getElementById("o-units").value === "imperial" && ob.units === "imperial";
        ob.sex = document.getElementById("o-sex").value; ob.age = +document.getElementById("o-age").value; ob.act = +document.getElementById("o-act").value;
        const w = +document.getElementById("o-w").value;
        ob.kg = ob.units === "imperial" ? w / 2.2046 : w;
        ob.cm = ob.units === "imperial" ? (+document.getElementById("o-ft").value * 12 + +document.getElementById("o-in").value) * 2.54 : +document.getElementById("o-cm").value;
        return imp;
      };
      document.getElementById("o-units").addEventListener("change", e => { read(); ob.units = e.target.value; renderOnboarding(); });
      document.getElementById("o-back").addEventListener("click", () => { ob.step = 1; renderOnboarding(); });
      document.getElementById("ob2").addEventListener("submit", ev => {
        ev.preventDefault(); read(); const err = document.getElementById("o-err");
        if (!(ob.age >= 16 && ob.age <= 90)) return err.textContent = "Enter an age between 16 and 90.";
        if (!(ob.kg >= 30 && ob.kg <= 300)) return err.textContent = "Enter a realistic weight.";
        if (!(ob.cm >= 120 && ob.cm <= 230)) return err.textContent = "Enter a realistic height.";
        ob.step = 3; renderOnboarding();
      });
    } else {
      const g = GOA[ob.goal];
      const t = RS.targets({ sex: ob.sex, kg: ob.kg, cm: ob.cm, age: ob.age, act: ob.act }, DIE[ob.diet], g);
      h(`<div class="card">${dots(3)}<h1 style="font-size:2.6rem">Your plan</h1>
        <p>For <strong>${esc(g.name.toLowerCase())}</strong> we recommend the split and diet below. Pick a different one if you prefer.</p>
        <h2 style="font-size:1.6rem;margin-top:1em">Workout split</h2>
        <div class="choices" id="o-splits">${D.splits.map(s => choice(s.slug, s.name, `${s.days} days/week. ${s.best_for}`, ob.split === s.slug)).join("")}</div>
        <h2 style="font-size:1.6rem">Diet</h2>
        <div class="choices" id="o-diets">${D.diets.map(d => choice(d.slug, d.name, d.summary, ob.diet === d.slug)).join("")}</div>
        <div class="result">${[["Calories", t.kcal], ["Protein", t.protein + " g"], ["Carbs", t.carbs + " g"], ["Fat", t.fat + " g"]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l} per day</span></div>`).join("")}</div>
        ${t.floored ? `<p class="notice" style="margin-top:12px">Calories were raised to a safe minimum. Speak to a doctor or dietitian before eating less.</p>` : ""}
        <div class="actions"><button class="btn ghost" id="o-back">Back</button><button class="btn blue" id="o-go">Start my plan today</button></div></div>`);
      root.querySelectorAll("#o-splits .choice").forEach(b => b.addEventListener("click", () => { ob.split = b.dataset.v; renderOnboarding(); }));
      root.querySelectorAll("#o-diets .choice").forEach(b => b.addEventListener("click", () => { ob.diet = b.dataset.v; renderOnboarding(); }));
      document.getElementById("o-back").addEventListener("click", () => { ob.step = 2; renderOnboarding(); });
      document.getElementById("o-go").addEventListener("click", () => {
        data.profile = { goal: ob.goal, units: ob.units, sex: ob.sex, age: ob.age, kg: ob.kg, cm: ob.cm, act: ob.act };
        data.plan = { split: ob.split, diet: ob.diet, start: today() };
        data.weights = [{ date: today(), kg: ob.kg }];
        save(); history.replaceState(null, "", location.pathname); tab = "today"; renderDash();
      });
    }
  }

  /* ---------- dashboard ---------- */
  let tab = "today";
  const TABS = [["today", "Today"], ["week", "Schedule"], ["split", "Splits"], ["food", "Nutrition"], ["progress", "Progress"], ["settings", "Settings"]];
  function renderDash() {
    const body = { today: vToday, week: vWeek, split: vSplit, food: vFood, progress: vProgress, settings: vSettings }[tab]();
    const offer = (wantSplit && wantSplit !== data.plan.split) ? `<div class="notice">Switch your plan to <strong>${esc(SPL[wantSplit].name)}</strong>? Your new split starts today. <button class="btn sm blue" data-switch="${wantSplit}">Switch split</button></div>` :
      (wantDiet && wantDiet !== data.plan.diet) ? `<div class="notice">Switch your diet to <strong>${esc(DIE[wantDiet].name)}</strong>? <button class="btn sm blue" data-sdiet="${wantDiet}">Switch diet</button></div>` : "";
    h(`<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px"><h1 style="font-size:2.4rem;margin:0">Hi, ${esc(user)}</h1><span class="muted small">${nice(today())}</span></div>
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}">${l}</button>`).join("")}</div>
      ${offer}<div role="tabpanel">${body}</div>`);
    root.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; renderDash(); }));
    root.querySelectorAll("[data-switch]").forEach(b => b.addEventListener("click", () => switchSplit(b.dataset.switch)));
    root.querySelectorAll("[data-sdiet]").forEach(b => b.addEventListener("click", () => { data.plan.diet = b.dataset.sdiet; save(); history.replaceState(null, "", location.pathname); renderDash(); }));
    (bind[tab] || (() => { }))();
  }
  function switchSplit(slug) {
    data.plan.split = slug; data.plan.start = today(); delete data.log[today()];
    save(); history.replaceState(null, "", location.pathname); tab = "today"; renderDash();
  }

  function dayCell(date, key, s, extra = "") {
    const p = s.dayplans[key], d = parse(date);
    return `<div class="day t-${p.type}${extra}"><span class="dname">${date === today() ? "Today" : WD[d.getDay()]}</span><span class="dnum">${d.getDate()}</span><span class="dtitle">${esc(p.title)}</span></div>`;
  }

  function vToday() {
    const sc = schedule(), s = sc.split, t = sc.today, p = s.dayplans[t.key];
    const missedRecent = sc.past.slice(-7).filter(x => x.status === "missed" || x.status === "skipped").length;
    const log = data.log[t.date] || {};
    let main;
    if (p.type === "rest") {
      main = `<div class="card" style="border-top:6px solid var(--grey)"><h2 style="margin-top:0">Rest day</h2><p>${esc(p.note)}</p></div>`;
    } else {
      const checks = log.ex || [];
      const statusLine = t.status === "done" ? `<p class="notice" style="background:color-mix(in srgb,var(--green) 15%,var(--surface));border-color:var(--green)">Workout done. Nice work.</p>` :
        t.status === "skipped" ? `<p class="notice">Skipped. ${esc(p.title)} moves to tomorrow and the rest of your plan shifts with it.</p>` : "";
      main = `<div class="card t-${p.type}" style="border-top:6px solid var(--c)">
        <h2 style="margin-top:0">${esc(p.title)}</h2><p class="muted small">${esc(s.name)}</p>${statusLine}
        <ul class="ex-list">${p.exercises.map((x, i) => `<li><input type="checkbox" id="ex${i}" data-ex="${i}" ${checks[i] ? "checked" : ""} ${t.status === "skipped" ? "disabled" : ""}><label for="ex${i}" style="margin:0;font-weight:600">${esc(x[0])}</label><span class="sets">${x[1]} × ${esc(String(x[2]))}</span></li>`).join("")}</ul>
        <div class="actions">${t.status === "done" ? `<button class="btn ghost" id="undo">Undo</button>` : t.status === "skipped" ? `<button class="btn ghost" id="undo">Undo skip</button>` :
          `<button class="btn blue" id="done">Mark workout done</button><button class="btn ghost" id="skip">Skip today</button>`}</div></div>`;
    }
    const next = sc.upcoming.slice(0, 6);
    return `${missedRecent ? `<p class="notice">${missedRecent} training day${missedRecent > 1 ? "s were" : " was"} missed or skipped this past week, so your plan shifted forward. Nothing was dropped.</p>` : ""}
      ${main}
      <div class="week"><div class="week-head"><strong>Coming up</strong><button class="btn sm ghost" data-tab="week">Full schedule</button></div>
      <div class="days">${dayCell(t.date, t.key, s, " today" + (t.status === "done" ? " done" : t.status === "skipped" ? " skipped" : ""))}${next.map(u => dayCell(u.date, u.key, s)).join("")}</div></div>
      ${foodSummaryCard()}`;
  }
  function foodSummaryCard() {
    const t = targets(), tot = dayTotals(today());
    return `<div class="card" style="margin-top:18px"><h3 style="margin-top:0">Today's nutrition</h3>${macroBars(tot, t)}<button class="btn sm ghost" data-tab="food">Log food</button></div>`;
  }
  const bind = {};
  bind.today = () => {
    const t = today(), sc = schedule();
    const cur = () => data.log[t] || (data.log[t] = { status: "pending", key: sc.today.key, ex: [] });
    root.querySelectorAll("[data-ex]").forEach(c => c.addEventListener("change", () => { const l = cur(); l.ex[+c.dataset.ex] = c.checked; save(); }));
    const done = document.getElementById("done"), skip = document.getElementById("skip"), undo = document.getElementById("undo");
    if (done) done.addEventListener("click", () => { const l = cur(); l.status = "done"; save(); renderDash(); });
    if (skip) skip.addEventListener("click", () => { const l = cur(); l.status = "skipped"; save(); renderDash(); });
    if (undo) undo.addEventListener("click", () => { const l = cur(); l.status = "pending"; save(); renderDash(); });
  };

  function vWeek() {
    const sc = schedule(), s = sc.split;
    const recent = sc.past.slice(-10).reverse();
    const label = { done: "Done", skipped: "Skipped, moved forward", missed: "Not logged, moved forward", rest: "Rest" };
    return `<div class="week"><div class="week-head"><strong>Next two weeks</strong><span class="small muted">${esc(s.name)} since ${nice(data.plan.start)}</span></div>
      <div class="days">${dayCell(sc.today.date, sc.today.key, s, " today")}${sc.upcoming.map(u => dayCell(u.date, u.key, s)).join("")}</div></div>
      <div class="card" style="margin-top:18px"><h3 style="margin-top:0">How shifting works</h3><p class="small">A training day only counts when you mark it done. If you skip it or don't log it, the same session is scheduled for the next day and the rest of the cycle moves back by one day. Rest days stay in their place in the cycle.</p></div>
      <div class="card"><h3 style="margin-top:0">Recent days</h3>${recent.length ? `<div class="table-scroll"><table><tbody>${recent.map(r => `<tr><td>${nice(r.date)}</td><td>${esc(s.dayplans[r.key].title)}</td><td>${label[r.status]}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Your history will appear here after your first day.</p>`}</div>`;
  }
  bind.week = () => { };

  function vSplit() {
    const cur = SPL[data.plan.split];
    return `<div class="card"><h2 style="margin-top:0">Current split: ${esc(cur.name)}</h2><p>${esc(cur.summary)} <a href="/splits/${cur.slug}/">Full details</a></p></div>
      <h2 style="font-size:1.7rem">Change split</h2><p class="muted small">A new split starts today, from its first day.</p>
      <div class="choices" id="splits">${D.splits.map(s => choice(s.slug, s.name, `${s.days} days/week. ${s.best_for}`, s.slug === cur.slug)).join("")}</div>`;
  }
  bind.split = () => root.querySelectorAll("#splits .choice").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.v === data.plan.split) return;
    if (confirm(`Switch to ${SPL[b.dataset.v].name}? It starts today.`)) switchSplit(b.dataset.v);
  }));

  /* nutrition */
  function dayTotals(date) {
    const items = data.food[date] || [];
    return items.filter(it => FOOD[it.n]).reduce((a, it) => { const f = FOOD[it.n], m = it.g / 100; a.kcal += f[2] * m; a.p += f[3] * m; a.c += f[4] * m; a.f += f[5] * m; return a; }, { kcal: 0, p: 0, c: 0, f: 0 });
  }
  function macroBars(tot, t) {
    const row = (l, v, max, c, u) => `<div class="small"><strong>${l}</strong> ${Math.round(v)} / ${max}${u}</div><div class="bar" style="--c:var(--${c})"><i style="width:${Math.min(100, v / max * 100)}%"></i></div>`;
    return row("Calories", tot.kcal, t.kcal, "blue", " kcal") + row("Protein", tot.p, t.protein, "red", " g") + row("Carbs", tot.c, t.carbs, "yellow", " g") + row("Fat", tot.f, t.fat, "green", " g");
  }
  function vFood() {
    const t = targets(), d = DIE[data.plan.diet], items = data.food[today()] || [], tot = dayTotals(today());
    return `<div class="card"><h2 style="margin-top:0">${esc(d.name)}</h2><p class="small">${esc(d.summary)} <a href="/diets/${d.slug}/">What to eat</a></p>
      <div class="result">${[["Calories", t.kcal], ["Protein", t.protein + " g"], ["Carbs", t.carbs + " g"], ["Fat", t.fat + " g"]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l} target</span></div>`).join("")}</div></div>
      <div class="card"><h3 style="margin-top:0">Log food for today</h3>
      <div class="row"><div class="field"><label for="f-q">Food</label><input id="f-q" placeholder="Search, e.g. oats" autocomplete="off"></div>
      <div class="field"><label for="f-g">Amount (g)</label><input id="f-g" type="number" value="100" min="1"></div></div>
      <div id="f-res"></div>
      ${macroBars(tot, t)}
      ${items.length ? `<div class="table-scroll"><table><thead><tr><th>Food</th><th class="num">g</th><th class="num">kcal</th><th class="num">Protein</th><th></th></tr></thead><tbody>
        ${items.map((it, k) => { const f = FOOD[it.n]; if (!f) return ""; const m = it.g / 100; return `<tr><td>${esc(f[0])}</td><td class="num">${it.g}</td><td class="num">${Math.round(f[2] * m)}</td><td class="num">${(f[3] * m).toFixed(1)} g</td><td class="num"><button class="btn sm ghost" data-rm="${k}" aria-label="Remove ${esc(f[0])}">Remove</button></td></tr>`; }).join("")}
        </tbody></table></div>` : `<p class="muted small">Nothing logged yet today. Search for a food above to add it.</p>`}</div>
      <h2 style="font-size:1.7rem">Change diet</h2><div class="choices" id="diets">${D.diets.map(x => choice(x.slug, x.name, x.summary, x.slug === d.slug)).join("")}</div>`;
  }
  bind.food = () => {
    const q = document.getElementById("f-q"), g = document.getElementById("f-g"), res = document.getElementById("f-res");
    q.addEventListener("input", () => {
      const term = q.value.trim().toLowerCase();
      if (term.length < 2) { res.innerHTML = ""; return; }
      const hits = D.foods.map((f, i) => [f, i]).filter(([f]) => f[0].toLowerCase().includes(term)).slice(0, 8);
      res.innerHTML = hits.length ? `<ul class="ex-list" style="margin-bottom:14px">${hits.map(([f, i]) => `<li><span>${esc(f[0])} <span class="muted small">${f[2]} kcal, ${f[3]} g protein per 100 g</span></span><button class="btn sm" data-add="${i}" style="margin-left:auto">Add</button></li>`).join("")}</ul>` : `<p class="small muted">No match. Try a simpler word.</p>`;
      res.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => {
        const grams = Math.max(1, Math.round(+g.value || 100));
        (data.food[today()] = data.food[today()] || []).push({ n: D.foods[+b.dataset.add][0], g: grams }); save(); renderDash();
      }));
    });
    root.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { data.food[today()].splice(+b.dataset.rm, 1); save(); renderDash(); }));
    root.querySelectorAll("#diets .choice").forEach(b => b.addEventListener("click", () => { data.plan.diet = b.dataset.v; save(); renderDash(); }));
  };

  /* progress */
  function vProgress() {
    const ws = [...data.weights].sort((a, b) => a.date < b.date ? -1 : 1);
    const done = Object.values(data.log).filter(l => l.status === "done").length;
    const last7 = Object.entries(data.log).filter(([d, l]) => d > add(today(), -7) && l.status === "done").length;
    let chart = "";
    if (ws.length > 1) {
      const vals = ws.map(w => w.kg), mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
      const pts = ws.map((w, i) => `${(i / (ws.length - 1) * 580 + 10).toFixed(1)},${(150 - (w.kg - mn) / span * 130).toFixed(1)}`).join(" ");
      chart = `<svg viewBox="0 0 600 160" role="img" aria-label="Bodyweight trend" style="width:100%;height:auto;margin:8px 0"><polyline fill="none" stroke="var(--blue)" stroke-width="3" points="${pts}"/></svg>`;
    }
    return `<div class="result" style="margin-top:0;margin-bottom:18px">${[["Workouts done", done], ["Last 7 days", last7], ["Current weight", ws.length ? fmtW(ws[ws.length - 1].kg) : "None"]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
      <div class="card"><h3 style="margin-top:0">Log bodyweight</h3><div class="row"><div class="field"><label for="w-v">Today's weight (${data.profile.units === "metric" ? "kg" : "lb"})</label><input id="w-v" type="number" step="0.1"></div></div>
      <button class="btn blue" id="w-add">Save weight</button>${chart}
      ${ws.length ? `<div class="table-scroll"><table><tbody>${ws.slice(-10).reverse().map(w => `<tr><td>${nice(w.date)}</td><td class="num">${fmtW(w.kg)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="small muted">Weigh in at the same time of day, ideally in the morning. Compare weekly averages rather than single days.</p></div>`;
  }
  bind.progress = () => document.getElementById("w-add").addEventListener("click", () => {
    const v = +document.getElementById("w-v").value; if (!v) return;
    const kg = data.profile.units === "metric" ? v : v / 2.2046;
    data.weights = data.weights.filter(w => w.date !== today()); data.weights.push({ date: today(), kg });
    data.profile.kg = kg; save(); renderDash();
  });

  /* settings */
  function vSettings() {
    const p = data.profile;
    return `<div class="card"><h3 style="margin-top:0">Goal</h3><p>${esc(GOA[p.goal].name)}</p><button class="btn ghost" id="s-redo">Change goal and redo setup</button></div>
      <div class="card"><h3 style="margin-top:0">Units</h3><select id="s-units"><option value="imperial" ${p.units === "imperial" ? "selected" : ""}>Imperial</option><option value="metric" ${p.units === "metric" ? "selected" : ""}>Metric</option></select></div>
      <div class="card"><h3 style="margin-top:0">Your data</h3><p class="small">Everything is stored in this browser. Export a copy to keep a backup.</p>
      <div class="actions"><button class="btn ghost" id="s-export">Export data</button><button class="btn ghost" id="s-logout">Log out</button><button class="btn ghost" id="s-del" style="color:var(--red);border-color:var(--red)">Delete account</button></div></div>`;
  }
  bind.settings = () => {
    document.getElementById("s-redo").addEventListener("click", () => {
      Object.assign(ob, { step: 1, goal: data.profile.goal, units: data.profile.units, sex: data.profile.sex, age: data.profile.age, kg: data.profile.kg, cm: data.profile.cm, act: data.profile.act });
      renderOnboarding();
    });
    document.getElementById("s-units").addEventListener("change", e => { data.profile.units = e.target.value; save(); });
    document.getElementById("s-export").addEventListener("click", () => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = `elyqentra-${user}-${today()}.json`; a.click();
    });
    document.getElementById("s-logout").addEventListener("click", () => { ls.del("rs_session"); location.hash = "login"; start(); });
    document.getElementById("s-del").addEventListener("click", () => {
      if (!confirm("Delete your account and all data on this device? This cannot be undone.")) return;
      const u = Store.users(); delete u[user]; ls.set("rs_users", u); ls.del("rs_data_" + user); ls.del("rs_session"); location.hash = "signup"; start();
    });
  };

  /* ---------- boot ---------- */
  function start() {
    user = Store.session(); data = user ? Store.load(user) : null;
    if (!user || !data || !Store.users()[user]) { ls.del("rs_session"); user = null; return renderAuth(location.hash === "#login" ? "login" : (location.hash === "#signup" || !Object.keys(Store.users()).length) ? "signup" : "login"); }
    if (!data.profile || !data.plan) return renderOnboarding();
    renderDash();
  }
  window.addEventListener("hashchange", () => { if (!Store.session()) start(); });
  start();
})();

/* Shared helpers + public page behaviour */
window.RS = {
  bmr(sex, kg, cm, age) { return 10 * kg + 6.25 * cm - 5 * age + (sex === "m" ? 5 : -161); },
  targets(p, diet, goal) {
    const bmr = RS.bmr(p.sex, p.kg, p.cm, p.age);
    const tdee = bmr * p.act;
    const adj = diet && diet.adj !== null && diet.adj !== undefined ? diet.adj : (goal ? goal.adj : 0);
    const floor = p.sex === "m" ? 1500 : 1200;
    const kcal = Math.max(Math.round((tdee + adj) / 10) * 10, floor);
    const protein = Math.round((diet ? diet.protein : 1.8) * p.kg);
    let fat, carbs;
    if (diet && diet.carbs_cap) { carbs = diet.carbs_cap; fat = Math.round((kcal - protein * 4 - carbs * 4) / 9); }
    else {
      fat = Math.round(kcal * (diet ? diet.fat_pct : 0.3) / 9);
      carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
      if (carbs < 0) { carbs = 0; fat = Math.round((kcal - protein * 4) / 9); }
    }
    return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat, carbs, floored: kcal === floor && tdee + adj < floor };
  },
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
};

document.addEventListener("DOMContentLoaded", () => {
  // mobile menu
  const mb = document.querySelector(".menu-btn"), nav = document.getElementById("nav");
  if (mb) mb.addEventListener("click", () => { const o = nav.classList.toggle("open"); mb.setAttribute("aria-expanded", o); });

  // home demo: skipping shifts the week
  const dd = document.getElementById("demo-days");
  if (dd && window.DEMO_SEQ) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let skips = 0;
    const btn = document.getElementById("demo-skip"), msg = document.getElementById("demo-msg");
    const render = (animate) => {
      const now = new Date(); let h = "";
      for (let i = 0; i < 7; i++) {
        const d = new Date(now); d.setDate(now.getDate() + i);
        let s, cls = "";
        if (i < skips) { s = DEMO_SEQ[0]; cls = " skipped"; }
        else { s = DEMO_SEQ[(i - skips) % DEMO_SEQ.length]; if (animate && i >= skips) cls = " shifted"; }
        h += `<div class="day t-${s.y}${i === skips ? " today" : ""}${cls}"><span class="dname">${i === 0 ? "Today" : names[d.getDay()]}</span><span class="dnum">${d.getDate()}</span><span class="dtitle">${s.t}</span></div>`;
      }
      dd.innerHTML = h;
    };
    render(false);
    btn.addEventListener("click", () => {
      if (skips >= 3) { skips = 0; btn.textContent = "Skip today"; msg.textContent = "Tap “Skip today” to see the week shift."; render(false); return; }
      skips++;
      msg.textContent = `${DEMO_SEQ[0].t} moved forward ${skips} day${skips > 1 ? "s" : ""}. Every later session moved with it.`;
      btn.textContent = skips >= 3 ? "Reset" : "Skip again";
      render(true);
    });
  }

  // food table
  const ft = document.getElementById("food-table");
  if (ft) {
    const q = document.getElementById("food-q"), cat = document.getElementById("food-cat"), sort = document.getElementById("food-sort");
    const tbody = ft.tBodies[0];
    const all = Array.from(tbody.rows);
    const items = all.filter(r => !r.classList.contains("cat-row"));
    const apply = () => {
      const term = q.value.trim().toLowerCase(), c = cat.value, sv = sort.value;
      let vis = items.filter(r => (!term || r.dataset.name.includes(term)) && (!c || r.dataset.cat === c));
      tbody.innerHTML = "";
      if (sv) {
        const val = r => sv === "pd" ? (+r.cells[2].textContent / Math.max(+r.cells[1].textContent, 1)) : +r.cells[+sv].textContent;
        vis.sort((a, b) => val(b) - val(a)).forEach(r => tbody.appendChild(r));
      } else {
        all.forEach(r => {
          if (r.classList.contains("cat-row")) { if (!term && (!c || r.dataset.cat === c)) tbody.appendChild(r); }
          else if (vis.includes(r)) tbody.appendChild(r);
        });
      }
      if (!vis.length) tbody.innerHTML = '<tr><td colspan="6">No foods match. Try a shorter search term.</td></tr>';
    };
    [q, cat, sort].forEach(el => el.addEventListener("input", apply));
  }

  // calculator
  const calc = document.getElementById("calc");
  if (calc && window.CALC_DATA) {
    const $ = id => document.getElementById(id);
    const units = $("c-units");
    const goalSel = $("c-goal"), dietSel = $("c-diet");
    goalSel.addEventListener("change", () => { const g = CALC_DATA.goals.find(x => x.id === goalSel.value); if (g) dietSel.value = g.diet; });
    dietSel.value = CALC_DATA.goals[0].diet;
    units.addEventListener("change", () => {
      const m = units.value === "metric";
      calc.querySelectorAll(".imp").forEach(x => x.classList.toggle("hidden", m));
      calc.querySelectorAll(".met").forEach(x => x.classList.toggle("hidden", !m));
      const w = +$("c-w").value;
      $("c-wl").textContent = m ? "Weight (kg)" : "Weight (lb)";
      $("c-w").value = m ? Math.round(w / 2.2046) : Math.round(w * 2.2046);
    });
    $("c-go").addEventListener("click", () => {
      const m = units.value === "metric";
      const kg = m ? +$("c-w").value : +$("c-w").value / 2.2046;
      const cm = m ? +$("c-cm").value : (+$("c-ft").value * 12 + +$("c-in").value) * 2.54;
      const age = +$("c-age").value;
      if (!kg || !cm || !age) { $("c-note").textContent = "Fill in age, weight and height to calculate."; $("c-out").classList.remove("hidden"); return; }
      const diet = CALC_DATA.diets.find(d => d.slug === dietSel.value), goal = CALC_DATA.goals.find(g => g.id === goalSel.value);
      const t = RS.targets({ sex: $("c-sex").value, kg, cm, age, act: +$("c-act").value }, diet, goal);
      $("c-res").innerHTML = [["Calories per day", t.kcal], ["Maintenance (TDEE)", t.tdee], ["Protein", t.protein + " g"], ["Carbs", t.carbs + " g"], ["Fat", t.fat + " g"], ["BMR", t.bmr]]
        .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
      $("c-note").textContent = t.floored ? "Your target was raised to a safe minimum. Talk to a doctor or dietitian before eating less than this." :
        `Based on the ${diet.name} plan with the “${goal.name}” goal.`;
      $("c-out").classList.remove("hidden");
    });
  }
});

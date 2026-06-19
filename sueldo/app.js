// Calculadora de sueldos por oficio · Nexo Noruega
// Datos: SSB tabla 11418 (2025) + Skatteetaten 2026. Todo client-side.

(function () {
  "use strict";

  var DATA = null;
  var CATS = {};
  var current = null; // { o, s }
  var UTM = parseUtm();

  var $ = function (id) { return document.getElementById(id); };
  var inp = $("oficio"), ac = $("ac"), go = $("go");

  // ---------- utilidades ----------
  function parseUtm() {
    var q = new URLSearchParams(location.search), o = {};
    ["utm_source", "utm_medium", "utm_campaign", "t"].forEach(function (k) {
      if (q.get(k)) o[k] = q.get(k);
    });
    return o;
  }
  function norm(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\b(soy|un|una|el|la|los|las|de|del|trabajo|como|en|para|mi|hago|hacer|quiero|ser)\b/g, " ")
      .replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
  }
  function kr(n) { return Math.round(n).toLocaleString("es-ES") + " kr"; }
  function eur(nok) { return Math.round(nok / DATA.meta.nok_por_eur); }
  function eeur(n) { return "≈ " + Math.round(n).toLocaleString("es-ES") + " €"; }
  function esc(s) { return (s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function lev(a, b) {
    var m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  // ---------- matching ----------
  function termScore(term, q) {
    if (!term || !q) return 0;
    if (term === q) return 1;
    if (term.indexOf(q) === 0) return q.length >= 3 ? 0.92 : 0.8;
    if (q.indexOf(term) === 0) return 0.85;
    var tw = term.split(" ");
    if (tw.indexOf(q) !== -1) return 0.82;
    if (term.indexOf(q) !== -1) return 0.62 + Math.min(0.13, (q.length / term.length) * 0.13);
    if (q.indexOf(term) !== -1) return 0.6;
    var qw = q.split(" ");
    var inter = qw.filter(function (w) { return w.length > 2 && tw.some(function (t) { return t.indexOf(w) === 0; }); }).length;
    var tok = inter ? Math.min(0.6, 0.4 + 0.1 * inter) : 0;
    var L = Math.max(term.length, q.length);
    var lr = L ? (1 - lev(term, q) / L) : 0;
    return Math.max(tok, lr * 0.7);
  }
  function scoreOf(o, q) {
    var best = 0;
    for (var i = 0; i < o._terms.length; i++) {
      var s = termScore(o._terms[i], q);
      if (s > best) best = s;
      if (best === 1) break;
    }
    return best;
  }
  function rank(raw) {
    var q = norm(raw); if (!q) return [];
    var arr = DATA.oficios.map(function (o) { return { o: o, s: scoreOf(o, q) }; });
    arr.sort(function (a, b) { return b.s - a.s || a.o.nombre_es.localeCompare(b.o.nombre_es, "es"); });
    return arr;
  }

  // ---------- fiscal (modelo simplificado Skatteetaten 2026) ----------
  function impuestoAnual(bruto) {
    var f = DATA.fiscal_2026;
    var minste = Math.min(f.minstefradrag_pct * bruto, f.minstefradrag_tope);
    var base = Math.max(0, bruto - minste - f.personfradrag);
    var felles = f.alminnelig_inntekt * base;
    var trinn = 0;
    f.trinnskatt.forEach(function (t) {
      if (bruto > t.desde) {
        var top = t.hasta == null ? bruto : Math.min(bruto, t.hasta);
        trinn += (top - t.desde) * t.tasa;
      }
    });
    var trygde = bruto > 100000 ? f.trygdeavgift * bruto : 0;
    return felles + trinn + trygde;
  }
  function netoMes(brutoMes) {
    var brutoAnual = brutoMes * 12;
    var neto = brutoAnual - impuestoAnual(brutoAnual);
    return neto / 12;
  }

  // ---------- remates (patrón E, dato-puñetazo; uno por oficio) ----------
  var REMATES = [
    "No es que cobres más. Es que dejas de pagar lo que allí pagas aparte.",
    "El bruto se cobra. El neto se vive. Mira la diferencia.",
    "Mismo oficio, otro país, otro final de mes.",
    "Aquí el sueldo no es el truco. El truco es lo que ya no pagas."
  ];

  // ---------- navegación entre pantallas ----------
  function show(id) {
    ["s-input", "s-gate", "s-result"].forEach(function (s) { $(s).classList.toggle("hidden", s !== id); });
    var el = $(id); el.classList.remove("step"); void el.offsetWidth; el.classList.add("step");
  }

  // ---------- autocompletar ----------
  var acItems = [], acIdx = -1;
  function renderAc(v) {
    if (norm(v).length < 2) { ac.innerHTML = ""; acItems = []; acIdx = -1; inp.setAttribute("aria-expanded", "false"); return; }
    var top = rank(v).filter(function (x) { return x.s > 0.34; }).slice(0, 6);
    acItems = top; acIdx = -1;
    ac.innerHTML = top.map(function (x, i) {
      var cat = CATS[x.o.grupo] || "";
      return '<button type="button" role="option" data-i="' + i + '"><span>' + esc(cap1(x.o.nombre_es)) + '</span><span class="cat">' + esc(cat) + "</span></button>";
    }).join("");
    inp.setAttribute("aria-expanded", top.length ? "true" : "false");
    Array.prototype.forEach.call(ac.querySelectorAll("button"), function (b) {
      b.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
        var x = acItems[+b.getAttribute("data-i")];
        inp.value = cap1(x.o.nombre_es); ac.innerHTML = ""; acItems = [];
        toGate(x);
      });
    });
  }

  // ---------- ir al gate ----------
  function toGate(match) {
    if (!match) { var r = rank(inp.value); if (!r.length) { inp.focus(); return; } match = r[0]; }
    current = match;
    ac.innerHTML = "";
    $("gate-of").innerHTML = esc(cap1(match.o.nombre_es)) + '<span class="cat">' + esc(CATS[match.o.grupo] || "") + "</span>";
    var ap = $("gate-approx");
    if (match.s < 0.6) {
      ap.textContent = "Te lo calculo como lo más parecido que hay en la tabla. Si no es tu oficio, prueba otra palabra.";
      ap.classList.remove("hidden");
    } else { ap.classList.add("hidden"); }
    show("s-gate");
    setTimeout(function () { $("email").focus(); }, 60);
  }

  // ---------- captura de lead (no bloquea la UX) ----------
  function sendLead(email) {
    try {
      fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          oficio: current.o.nombre_es,
          styrk: current.o.styrk,
          confianza: Math.round(current.s * 100) / 100,
          utm_source: UTM.utm_source || "",
          utm_medium: UTM.utm_medium || "",
          utm_campaign: UTM.utm_campaign || "",
          token: UTM.t || ""
        }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // ---------- resultado ----------
  function animate(el, to, fmt) {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = fmt(to); return;
    }
    var t0 = null, dur = 850, done = false;
    function fin() { if (!done) { done = true; el.textContent = fmt(to); } }
    function step(ts) {
      if (done) return; // un frame que revive tras una pausa no debe pisar el valor final
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(step); else fin();
    }
    requestAnimationFrame(step);
    setTimeout(fin, dur + 250); // garantiza el valor final aunque rAF se pause
  }

  function renderResult(o, email) {
    var sal = o.salario;
    var netoM = netoMes(sal.mediana_mes);
    var serv = DATA.servicios_2026;
    var remate = REMATES[parseInt(o.styrk, 10) % REMATES.length];
    var cat = CATS[o.grupo] || "";
    var sub = "https://nexonoruega.substack.com/subscribe" + (email ? "?email=" + encodeURIComponent(email) : "");

    var h =
      '<div class="res-head"><span class="kicker" style="margin:0">Dato Nexo</span><span class="cat">' + esc(cap1(o.nombre_es)) + "<br>" + esc(cat) + "</span></div>" +

      '<div class="blk"><p class="lab">Lo que preguntaste</p>' +
        '<p class="num" id="r-bruto">0 kr</p>' +
        '<p class="eur">' + eeur(eur(sal.mediana_mes)) + ' al mes</p>' +
        '<p class="cap">Mediana en jornada completa. La mitad cobra más, la mitad menos.</p></div>' +

      '<div class="rango"><p class="lab">El rango real</p>' +
        '<p>La mayoría cobra entre <b>' + kr(sal.p25_mes) + "</b> y <b>" + kr(sal.p75_mes) + "</b> al mes.</p>" +
        '<p class="cap" style="margin-top:6px">Cuartiles reales por oficio (SSB). No es una estimación.</p></div>' +

      '<div class="blk"><p class="lab acc">Lo que importa</p>' +
        '<p class="num hero" id="r-neto">0 kr</p>' +
        '<p class="eur">' + eeur(eur(netoM)) + ' al mes</p>' +
        '<p class="cap">Después de impuestos (soltero, cálculo orientativo). Lo que entra en tu cuenta.</p></div>' +

      '<div class="blk"><p class="lab">Lo que dejas de pagar</p>' +
        '<p class="lista">' +
          'Guardería: tope <span class="d">' + kr(serv.barnehage_makspris_mes) + "/mes</span> (gratis en Finnmark)<br>" +
          'Universidad pública: <span class="d">0</span><br>' +
          'Sanidad: tope <span class="d">' + kr(serv.egenandelstak_anio) + "/año</span>, luego nada</p>" +
        '<p class="cap">Eso no sale de tu neto. Ya está dentro del sistema.</p></div>' +

      '<p class="remate">' + esc(remate) + "</p>" +

      '<div class="palabra"><span class="w">lønnsomt</span>' +
        '<span class="m">que sale a cuenta. No barato: rentable en el sentido honesto, lo que pones y lo que recibes en balance.</span></div>' +

      '<div class="res-cta"><p>No te mando un sueldo. Te mando el cálculo completo, cada quince días.</p>' +
        '<a class="btn" href="' + esc(sub) + '">Recibir la newsletter</a>' +
        '<button class="btn ghost" id="otro">Probar otro oficio</button></div>' +

      '<p class="fuente">Sueldos: SSB tabla 11418 (' + DATA.meta.anio_datos + ") · Impuestos: Skatteetaten 2026<br>Cambio orientativo " + DATA.meta.nok_por_eur + " kr/€ · cifras aproximadas</p>";

    var box = $("s-result");
    box.innerHTML = h;
    box.querySelector("#otro").addEventListener("click", reset);
    show("s-result");
    window.scrollTo({ top: 0, behavior: "smooth" });
    animate($("r-bruto"), sal.mediana_mes, kr);
    animate($("r-neto"), netoM, kr);
  }

  function reset() {
    inp.value = ""; $("email").value = ""; current = null;
    show("s-input"); inp.focus();
  }

  // ---------- eventos ----------
  function bind() {
    inp.addEventListener("input", function () { renderAc(inp.value); });
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" && acItems.length) { ev.preventDefault(); acIdx = Math.min(acItems.length - 1, acIdx + 1); markAc(); }
      else if (ev.key === "ArrowUp" && acItems.length) { ev.preventDefault(); acIdx = Math.max(0, acIdx - 1); markAc(); }
      else if (ev.key === "Enter") { ev.preventDefault(); if (acIdx >= 0 && acItems[acIdx]) { inp.value = cap1(acItems[acIdx].o.nombre_es); toGate(acItems[acIdx]); } else { toGate(null); } }
      else if (ev.key === "Escape") { ac.innerHTML = ""; acItems = []; }
    });
    inp.addEventListener("blur", function () { setTimeout(function () { ac.innerHTML = ""; }, 150); });
    go.addEventListener("click", function () { toGate(null); });
    $("back").addEventListener("click", function () { show("s-input"); inp.focus(); });
    $("unlock").addEventListener("click", unlock);
    $("email").addEventListener("keydown", function (ev) { if (ev.key === "Enter") unlock(); });
  }
  function markAc() {
    Array.prototype.forEach.call(ac.querySelectorAll("button"), function (b, i) { b.classList.toggle("sel", i === acIdx); });
  }
  function unlock() {
    var em = $("email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { $("email").focus(); $("email").style.borderColor = "#ff6b6b"; return; }
    if (!current) { show("s-input"); return; }
    sendLead(em);
    renderResult(current.o, em);
  }

  // ---------- arranque ----------
  fetch("../data/data.json").then(function (r) {
    if (!r.ok) throw new Error("data " + r.status);
    return r.json();
  }).then(function (d) {
    DATA = d;
    d.categorias.forEach(function (c) { CATS[c.codigo] = c.nombre_es; });
    d.oficios.forEach(function (o) {
      o._terms = [norm(o.nombre_es)].concat(o.alias_es.map(norm)).filter(Boolean);
    });
    bind();
    inp.focus();
  }).catch(function () {
    $("sello").textContent = "No se pudo cargar la tabla. Reintenta en un momento.";
  });
})();

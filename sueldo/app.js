// Calculadora de sueldos por oficio · Nexo Noruega
// Datos: SSB tabla 11418 (2025) + Skatteetaten 2026. Todo client-side.
// Flujo: el usuario escribe su oficio y ve el resultado directamente. Sin correo.

(function () {
  "use strict";

  var DATA = null;
  var CATS = {};
  var REG = null;      // data/regiones.json (se carga al revelar el primer resultado)
  var REG_FAIL = false;
  var current = null; // { o, s }

  var $ = function (id) { return document.getElementById(id); };
  var inp = $("oficio"), ac = $("ac"), go = $("go");

  // ---------- utilidades ----------
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
    ["s-input", "s-result"].forEach(function (s) { $(s).classList.toggle("hidden", s !== id); });
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
        pick(x);
      });
    });
  }

  // ---------- elegir oficio y mostrar resultado directamente ----------
  function pick(match) {
    if (!match) { var r = rank(inp.value); if (!r.length) { inp.focus(); return; } match = r[0]; }
    current = match;
    ac.innerHTML = "";
    renderResult(match.o, match.s);
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

  function renderResult(o, conf) {
    var sal = o.salario;
    var netoM = netoMes(sal.mediana_mes);
    var serv = DATA.servicios_2026;
    var remate = REMATES[parseInt(o.styrk, 10) % REMATES.length];
    var cat = CATS[o.grupo] || "";
    var aprox = conf < 0.6
      ? '<p class="aprox-res">Es lo más parecido que encontré. Si no es tu oficio, prueba otra palabra.</p>'
      : "";

    var h =
      '<div class="res-head"><span class="kicker" style="margin:0">Dato Nexo</span><span class="cat">' + esc(cap1(o.nombre_es)) + "</span></div>" +
      aprox +
      '<p class="reveal-intro">Esto es lo que ganarías haciendo tu oficio en Noruega.</p>' +

      '<div class="gate-card" id="gate-card">' +
        '<p class="gate-copy">Si te interesa cómo funciona la vida <mark class="hi">donde las cosas funcionan</mark>, suscríbete. Te llega a tu correo información sobre Noruega que no cuelgo en redes, de alguien que ya ha pasado por todas las fases.</p>' +
        '<iframe class="sub-embed" src="https://nexonoruega.substack.com/embed" title="Suscríbete a Nexo Noruega" loading="lazy"></iframe>' +
        '<button class="reveal-link" id="reveal">Ver el cálculo</button>' +
        '<p class="tillit-note">Aunque no te suscribas, puedes verlo. Eso es <span class="tw">tillit</span>, la confianza noruega: el sistema da primero y confía en que devuelvas.</p>' +
      '</div>' +

      '<div class="locked" id="locked">' +
        '<div class="blk"><p class="lab">Bruto al mes</p>' +
          '<p class="num" id="r-bruto">0 kr</p>' +
          '<p class="eur"><span id="e-bruto">' + eeur(eur(sal.mediana_mes)) + "</span> · la mayoría entre " + kr(sal.p25_mes) + " y " + kr(sal.p75_mes) + "</p></div>" +
        '<div class="blk"><p class="lab acc">Neto, lo que te queda</p>' +
          '<p class="num hero" id="r-neto">0 kr</p>' +
          '<p class="eur"><span id="e-neto">' + eeur(eur(netoM)) + "</span> · después de impuestos</p>" +
          '<p class="cap">Es una aproximación. El neto exacto depende de tu kommune, tus deducciones y tu situación: con tantas variables, nadie puede clavarlo de antemano.</p></div>' +
        '<p class="extra">Y no pagas aparte: guardería (tope ' + kr(serv.barnehage_makspris_mes) + "/mes), universidad gratis, sanidad (tope " + kr(serv.egenandelstak_anio) + "/año).</p>" +
        '<p class="remate">' + esc(remate) + "</p></div>" +

      '<div class="afinar hidden" id="afinar">' +
        '<p class="lab acc">¿Quieres afinar el tiro?</p>' +
        '<p class="afinar-txt">El rango es real, pero dentro del rango no todos caen en el mismo sitio. Ajusta:</p>' +
        '<div class="chips" role="group" aria-label="Tu momento en el oficio">' +
          '<button type="button" class="chip" data-exp="p25">Empezando</button>' +
          '<button type="button" class="chip sel" data-exp="med">Ya rodado</button>' +
          '<button type="button" class="chip" data-exp="p75">Veterano</button>' +
        '</div>' +
        '<p class="cap" id="exp-cap">La mediana: la mitad de los que hacen tu oficio en Noruega cobra más y la otra mitad cobra menos.</p>' +
        '<div id="reg-wrap" class="hidden">' +
          '<label class="lab" for="region" style="display:block;margin-top:18px">¿En qué zona?</label>' +
          '<select id="region" class="sel-region"></select>' +
          '<p class="cap" id="reg-line"></p>' +
        '</div>' +
      '</div>' +

      '<div class="res-foot"><button class="btn ghost" id="otro">Probar otro oficio</button>' +
        '<p class="fuente">SSB tablas 11418 y 11422 (' + DATA.meta.anio_datos + ") · Skatteetaten 2026 · cambio orient. " + DATA.meta.nok_por_eur + " kr/€</p></div>";

    var box = $("s-result");
    box.innerHTML = h;
    box.querySelector("#otro").addEventListener("click", reset);
    // Los números quedan listos pero borrosos hasta que desbloquea
    $("r-bruto").textContent = kr(sal.mediana_mes);
    $("r-neto").textContent = kr(netoM);
    box.querySelector("#reveal").addEventListener("click", function () {
      $("locked").classList.remove("locked");
      var gc = $("gate-card"); if (gc) gc.style.display = "none";
      animate($("r-bruto"), sal.mediana_mes, kr);
      animate($("r-neto"), netoM, kr);
      $("afinar").classList.remove("hidden");
      bindAfinar();
    });

    // ----- afinar el tiro (solo tras revelar) -----
    var EXP_CAP = {
      p25: "Parte baja del rango. Sin noruego, sin red de contactos y sin historial allí, se entra por aquí. La parte alta se gana con años, no con el billete de avión.",
      med: "La mediana: la mitad de los que hacen tu oficio en Noruega cobra más y la otra mitad cobra menos.",
      p75: "Parte alta del rango. Años de oficio, noruego fluido y saber lo que vales. Nadie aterriza aquí el primer año."
    };
    function applyExp(key) {
      var bruto = key === "p25" ? sal.p25_mes : key === "p75" ? sal.p75_mes : sal.mediana_mes;
      var neto = netoMes(bruto);
      animate($("r-bruto"), bruto, kr);
      animate($("r-neto"), neto, kr);
      $("e-bruto").textContent = eeur(eur(bruto));
      $("e-neto").textContent = eeur(eur(neto));
      $("exp-cap").textContent = EXP_CAP[key];
      Array.prototype.forEach.call(box.querySelectorAll(".chip"), function (c) {
        c.classList.toggle("sel", c.getAttribute("data-exp") === key);
      });
    }
    function buildRegion() {
      var por = REG && REG.grupos[o.grupo];
      if (!por || !por["0"]) return; // sin cruce regional para esta familia (p. ej. fuerzas armadas)
      var sel = $("region");
      sel.innerHTML = REG.regiones.filter(function (r) { return por[r.codigo] != null; })
        .map(function (r) { return '<option value="' + r.codigo + '">' + esc(r.nombre) + "</option>"; }).join("");
      var fam = (CATS[o.grupo] || "tu familia de oficios").toLowerCase();
      function upd() {
        var c = sel.value, v = por[c], base = por["0"], linea;
        if (c === "0") {
          linea = "Mediana nacional de tu familia de oficios (" + fam + "): " + kr(v) + ". Elige una zona para comparar.";
        } else {
          var pct = Math.round((v / base - 1) * 100);
          var comp = pct > 0 ? "un " + pct + "% por encima de" : pct < 0 ? "un " + Math.abs(pct) + "% por debajo de" : "igual que";
          linea = "Tu familia de oficios (" + fam + ") cobra ahí de mediana " + kr(v) + ", " + comp + " la mediana nacional del grupo. SSB no publica zonas por oficio exacto, solo por familia: úsalo como brújula, no como cifra.";
        }
        $("reg-line").textContent = linea;
      }
      sel.addEventListener("change", upd);
      $("reg-wrap").classList.remove("hidden");
      upd();
    }
    function bindAfinar() {
      Array.prototype.forEach.call(box.querySelectorAll(".chip"), function (c) {
        c.addEventListener("click", function () { applyExp(c.getAttribute("data-exp")); });
      });
      if (REG) { buildRegion(); }
      else if (!REG_FAIL) {
        fetch("/data/regiones.json").then(function (r) {
          if (!r.ok) throw new Error("regiones " + r.status);
          return r.json();
        }).then(function (d) { REG = d; buildRegion(); })
          .catch(function () { REG_FAIL = true; }); // sin regiones no pasa nada: la sección de experiencia sigue funcionando
      }
    }

    show("s-result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    inp.value = ""; current = null;
    show("s-input"); inp.focus();
  }

  // ---------- eventos ----------
  function bind() {
    inp.addEventListener("input", function () { renderAc(inp.value); });
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" && acItems.length) { ev.preventDefault(); acIdx = Math.min(acItems.length - 1, acIdx + 1); markAc(); }
      else if (ev.key === "ArrowUp" && acItems.length) { ev.preventDefault(); acIdx = Math.max(0, acIdx - 1); markAc(); }
      else if (ev.key === "Enter") { ev.preventDefault(); if (acIdx >= 0 && acItems[acIdx]) { inp.value = cap1(acItems[acIdx].o.nombre_es); pick(acItems[acIdx]); } else { pick(null); } }
      else if (ev.key === "Escape") { ac.innerHTML = ""; acItems = []; }
    });
    inp.addEventListener("blur", function () { setTimeout(function () { ac.innerHTML = ""; }, 150); });
    go.addEventListener("click", function () { pick(null); });
  }
  function markAc() {
    Array.prototype.forEach.call(ac.querySelectorAll("button"), function (b, i) { b.classList.toggle("sel", i === acIdx); });
  }

  // ---------- arranque ----------
  fetch("/data/data.json").then(function (r) {
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
    var s = $("sello");
    s.textContent = "No se pudo cargar la tabla de sueldos. Recarga la página para reintentar.";
    s.style.color = "#3FCB94";
  });
})();

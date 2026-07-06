// NEXO NORSK · app de práctica. Vanilla, sin dependencias.
// Sin cookie de acceso: modo demo con /data/norsk-demo.json.
// Con acceso: sesiones servidas por /api/norsk-preguntas y /api/norsk-leccion.

(function () {
  "use strict";

  var $app = document.getElementById("app");
  var $estado = document.getElementById("estado");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var LS = "nexo_norsk_v1";
  var LS_SIM = "nexo_norsk_simulacro";

  var MECANICA = {
    statsborger: { total: 36, puntuables: 32, aprobado: 24, minutos: 60, nombre: "Statsborgerprøven" },
    samfunns: { total: 38, puntuables: 34, aprobado: 26, minutos: 60, nombre: "Samfunnskunnskapsprøven" },
    demo: { total: 12, puntuables: 12, aprobado: 9, minutos: 20, nombre: "Simulacro de prueba" },
  };

  var MODULOS = { 1: "Educación y trabajo", 2: "Familia, salud y vida diaria", 3: "Noruega antes y ahora" };

  var state = {
    acceso: null,   // {plan, expires_at} o null (demo)
    demo: null,     // payload de /data/norsk-demo.json
    lecciones: [],  // índice de lecciones (si la API responde)
    idioma: "no",
    examen: "statsborger",
    prog: cargarProg(),
    sesion: null,   // {modo, mecanica, preguntas, i, respuestas, inicio}
  };
  state.idioma = state.prog.idioma || "no";
  state.examen = state.prog.examen || "statsborger";

  // ---------- persistencia ----------

  function cargarProg() {
    try {
      var p = JSON.parse(localStorage.getItem(LS) || "{}");
      p.temas = p.temas || {};
      p.falladas = p.falladas || [];
      p.simulacros = p.simulacros || [];
      // Backfill: simulacros de versiones anteriores no guardaban pct. Se reconstruye
      // desde puntos + mecánica para que el medidor no se quede en blanco.
      p.simulacros.forEach(function (s) {
        if (typeof s.pct !== "number" && s && MECANICA[s.examen] && typeof s.puntos === "number") {
          s.pct = Math.round((s.puntos / MECANICA[s.examen].puntuables) * 100);
        }
      });
      return p;
    } catch (e) { return { temas: {}, falladas: [], simulacros: [] }; }
  }
  function guardarProg() {
    state.prog.idioma = state.idioma;
    state.prog.examen = state.examen;
    try { localStorage.setItem(LS, JSON.stringify(state.prog)); } catch (e) {}
  }
  function anotarFallada(codigo) {
    if (state.prog.falladas.indexOf(codigo) === -1) {
      state.prog.falladas.push(codigo);
      if (state.prog.falladas.length > 100) state.prog.falladas.shift();
    }
  }
  function quitarFallada(codigo) {
    var i = state.prog.falladas.indexOf(codigo);
    if (i !== -1) state.prog.falladas.splice(i, 1);
  }

  // ---------- util ----------

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function limpiar() {
    // Todo cambio de pantalla mata el reloj del simulacro: sin esto, un timer
    // fugado puede "entregar" una sesión vieja desde otra pantalla.
    if (relojTimer) { clearInterval(relojTimer); relojTimer = null; }
    $app.innerHTML = "";
    window.scrollTo(0, 0);
  }
  function barajar(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function fechaCorta(iso) {
    try {
      return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
    } catch (e) { return ""; }
  }
  // Nombre del examen para el encabezado del simulacro. La API no envía 'nombre' en
  // su mecánica, así que se deriva de examen (Statsborgerprøven / Samfunnskunnskapsprøven).
  function nombreExamen(ses) {
    return (ses.mecanica && ses.mecanica.nombre) ||
      (MECANICA[ses.examen] && MECANICA[ses.examen].nombre) || "Simulacro";
  }

  // Nota: todas las rutas de /api/ llevan barra final. vercel.json tiene
  // trailingSlash:true, que 308-redirige /api/x -> /api/x/. El navegador sigue
  // el redirect, pero lo evitamos para no depender de ello (y por el webhook).
  function api(path) {
    return fetch(path, { credentials: "same-origin" }).then(function (r) {
      if (r.status === 401) { var e = new Error("acceso"); e.code = 401; throw e; }
      if (r.status === 429) { var e2 = new Error("limite"); e2.code = 429; throw e2; }
      if (!r.ok) throw new Error("api " + r.status);
      return r.json();
    });
  }

  // ---------- arranque ----------

  function boot() {
    var pingP = api("/api/norsk-preguntas/?modo=ping").catch(function () { return null; });
    var demoP = fetch("/data/norsk-demo.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var lecP = api("/api/norsk-leccion/").catch(function () { return null; });

    Promise.all([pingP, demoP, lecP]).then(function (rs) {
      state.acceso = rs[0] && rs[0].ok ? rs[0] : null;
      state.demo = rs[1];
      state.lecciones = rs[2] && rs[2].ok ? rs[2].lecciones : [];
      pintarEstado();

      var sim = simulacroGuardado();
      if (sim) { reanudarSimulacro(sim); return; }
      renderInicio();
    });
  }

  function pintarEstado() {
    if (state.acceso) {
      $estado.textContent = "Acceso hasta el " + fechaCorta(state.acceso.expires_at);
      $estado.classList.add("activo");
    } else {
      $estado.textContent = "Demo";
      $estado.classList.remove("activo");
    }
  }

  // ---------- pantalla: inicio ----------

  function renderInicio() {
    limpiar();
    state.sesion = null;

    var s = el("section", { class: "step" });
    s.appendChild(el("p", { class: "kicker", text: "Nexo Norsk" }));
    s.appendChild(el("h1", { text: "¿Qué practicamos hoy?" }));
    s.appendChild(el("p", { class: "intro", text: state.acceso
      ? "Todo el banco está abierto. Elige examen y modo."
      : "Estás en la demo: la Lección 0 y un simulacro de 12 preguntas, gratis. El curso completo se abre al comprar." }));

    var med = medidorPreparacion();
    if (med) s.appendChild(med);

    // Examen
    var cards = el("div", { class: "cards", role: "radiogroup", "aria-label": "Elige examen" });
    [["statsborger", "Para la ciudadanía. Solo en noruego.", "36 preguntas · puntúan 32 · apruebas con 24 · 60 min"],
     ["samfunns", "Para la residencia permanente. En noruego vale doble.", "38 preguntas · puntúan 34 · apruebas con 26 · 60 min"]]
      .forEach(function (def) {
        var sel = state.examen === def[0];
        cards.appendChild(el("button", {
          class: "card" + (sel ? " sel" : ""), role: "radio", "aria-checked": String(sel),
          onclick: function () { state.examen = def[0]; guardarProg(); renderInicio(); },
        }, [
          el("span", { class: "t", text: MECANICA[def[0]].nombre }),
          el("span", { class: "m", text: def[1] }),
          el("span", { class: "mec", text: def[2] }),
        ]));
      });
    s.appendChild(cards);

    // Idioma
    var tg = el("div", { class: "toggle", role: "group", "aria-label": "Idioma de las preguntas" });
    [["no", "Norsk"], ["es", "Español"]].forEach(function (d) {
      tg.appendChild(el("button", {
        class: state.idioma === d[0] ? "sel" : "", "aria-pressed": String(state.idioma === d[0]),
        onclick: function () { state.idioma = d[0]; guardarProg(); renderInicio(); },
        text: d[1],
      }));
    });
    s.appendChild(tg);
    s.appendChild(el("p", { class: "toggle-nota", text: state.examen === "statsborger"
      ? "El examen real es solo en noruego. Practica en noruego; el español te espera en la corrección."
      : "La samfunns puedes hacerla en español. En noruego, además, te vale para la ciudadanía." }));

    // Menú
    var menu = el("div", { class: "menu" });
    var guardado = simulacroGuardado();
    if (guardado) {
      var respondidas = (guardado.respuestas || []).filter(function (r) { return r !== null; }).length;
      menu.appendChild(el("button", {
        class: "btn",
        text: "Continuar simulacro (" + respondidas + " respondidas)",
        onclick: function () { var g = simulacroGuardado(); if (g) reanudarSimulacro(g); else renderInicio(); },
      }));
      var nuevoBtn = el("button", { class: "btn ghost", text: "Empezar un simulacro nuevo" });
      nuevoBtn.addEventListener("click", function () {
        if (!nuevoBtn._confirmado) {
          nuevoBtn._confirmado = true;
          nuevoBtn.textContent = "¿Seguro? Borra el guardado. Pulsa otra vez";
          return;
        }
        borrarSimulacro();
        empezarSimulacro();
      });
      menu.appendChild(nuevoBtn);
    } else {
      menu.appendChild(el("button", { class: "btn", text: "Simulacro completo", onclick: empezarSimulacro }));
    }
    menu.appendChild(el("button", { class: "btn ghost", text: "Práctica por temas", onclick: renderTemas }));
    menu.appendChild(el("button", { class: "btn ghost", text: "Las lecciones del curso", onclick: renderLecciones }));
    if (state.prog.falladas.length) {
      menu.appendChild(el("button", { class: "btn ghost", text: "Repetir falladas (" + state.prog.falladas.length + ")", onclick: empezarFalladas }));
    }
    if (!state.acceso) {
      menu.appendChild(el("button", { class: "btn ghost", text: "Abrir el curso completo", onclick: renderCompra }));
    }
    s.appendChild(menu);

    if (state.prog.simulacros.length) {
      var ult = state.prog.simulacros[state.prog.simulacros.length - 1];
      s.appendChild(el("p", { class: "toggle-nota", style: "margin-top:18px",
        text: "Último simulacro: " + ult.puntos + " puntuables correctas, " + (ult.aprobado ? "aprobado." : "aún no.") }));
    }
    $app.appendChild(s);
  }

  // Medidor de preparación: verdicto honesto según el mejor de los últimos simulacros.
  // El umbral de aprobado ronda el 75-76% (24/32 y 26/34). Sin datos, no se muestra.
  function medidorPreparacion() {
    // El veredicto de verdad sale SOLO de simulacros completos (36/38 preguntas).
    // La demo (12) se muestra aparte, etiquetada, y nunca declara "Listo".
    var reales = state.prog.simulacros.filter(function (s) { return typeof s.pct === "number" && s.examen !== "demo"; });
    var demos = state.prog.simulacros.filter(function (s) { return typeof s.pct === "number" && s.examen === "demo"; });
    var esDemo = !reales.length;
    var base = esDemo ? demos : reales;
    if (!base.length) return null;
    var recientes = base.slice(-3);
    var mejor = recientes.reduce(function (m, s) { return Math.max(m, s.pct); }, 0);
    var aprobados = {};
    state.prog.simulacros.forEach(function (s) { if (s.aprobado && s.examen !== "demo") aprobados[s.examen + s.fecha + s.puntos] = 1; });
    var nAprob = Object.keys(aprobados).length;

    var banda, verdicto, msg;
    if (esDemo) {
      if (mejor >= 76) { banda = "cerca"; verdicto = "La demo, dominada"; }
      else if (mejor >= 60) { banda = "cerca"; verdicto = "Buen arranque"; }
      else { banda = "lejos"; verdicto = "Calentando"; }
      msg = "La demo son 12 preguntas de muestra. El veredicto real sale de los simulacros completos de 36, que se abren con el curso.";
    } else if (mejor >= 85) { banda = "listo"; verdicto = "Listo para el examen"; msg = "Apruebas con margen. Un repaso corto el día antes y a por el pasaporte."; }
    else if (mejor >= 76) { banda = "listo"; verdicto = "Casi listo"; msg = "Ya apruebas, pero justo. Un par de simulacros más y vas sobrado."; }
    else if (mejor >= 60) { banda = "cerca"; verdicto = "Cerca"; msg = "Te falta poco. Insiste en los temas donde más fallas."; }
    else { banda = "lejos"; verdicto = "Aún no"; msg = "Practica por temas sin prisa. El examen premia entender, no memorizar."; }

    var card = el("div", { class: "medidor " + banda });
    card.appendChild(el("p", { class: "med-lab", text: esDemo ? "Tu preparación · demo (12 preguntas)" : "Tu preparación" }));
    card.appendChild(el("p", { class: "med-verdicto", text: verdicto }));
    var barra = el("div", { class: "med-barra", "aria-hidden": "true" }, [
      el("span", { class: "med-fill", style: "width:" + Math.min(100, mejor) + "%" }),
      el("span", { class: "med-linea", title: "línea de aprobado" }),
    ]);
    card.appendChild(barra);
    card.appendChild(el("p", { class: "med-num", text: (esDemo ? "Mejor demo: " : "Mejor simulacro: ") + mejor + "% · aprobado en el 76%" }));
    card.appendChild(el("p", { class: "med-msg", text: msg }));
    if (state.acceso && nAprob > 0) {
      card.appendChild(el("p", { class: "med-gar", text: "Simulacros aprobados: " + nAprob + " de 5 (garantía)" }));
    }
    return card;
  }

  // ---------- pantalla: temas ----------

  function renderTemas() {
    limpiar();
    var s = el("section", { class: "step" });
    s.appendChild(el("button", { class: "back", text: "← Volver", onclick: renderInicio }));
    s.appendChild(el("h1", { text: "Práctica por temas" }));

    var lista = el("div", { class: "temas" });

    if (state.acceso) {
      var docentes = state.lecciones.filter(function (l) { return l.orden >= 1; });
      if (!docentes.length) {
        for (var i = 1; i <= 12; i++) docentes.push({ orden: i, titulo: "Lección " + i, modulo: i <= 3 ? 1 : i <= 8 ? 2 : 3 });
      }
      docentes.forEach(function (l) {
        var st = state.prog.temas["l" + l.orden];
        var pct = st && st.vistas ? Math.round(100 * st.aciertos / st.vistas) : null;
        lista.appendChild(el("button", {
          class: "tema",
          onclick: function () { empezarPractica({ leccion: l.orden, titulo: l.titulo }); },
        }, [
          el("span", { text: l.orden + ". " + l.titulo }),
          el("span", { class: "pct" + (pct !== null && pct >= 75 ? " bien" : ""), text: pct === null ? "·" : pct + "%" }),
        ]));
      });
    } else {
      [1, 2, 3].forEach(function (m) {
        var st = state.prog.temas["m" + m];
        var pct = st && st.vistas ? Math.round(100 * st.aciertos / st.vistas) : null;
        lista.appendChild(el("button", {
          class: "tema",
          onclick: function () { empezarPractica({ modulo: m, titulo: MODULOS[m] }); },
        }, [
          el("span", { text: "Módulo " + m + ". " + MODULOS[m] }),
          el("span", { class: "pct" + (pct !== null && pct >= 75 ? " bien" : ""), text: pct === null ? "·" : pct + "%" }),
        ]));
      });
      lista.appendChild(el("p", { class: "toggle-nota", style: "margin-top:10px",
        text: "En la demo practicas con 12 preguntas de muestra. Las más de 400 del banco se abren con el curso." }));
    }
    s.appendChild(lista);
    $app.appendChild(s);
  }

  // ---------- sesiones ----------

  function empezarPractica(filtro) {
    if (state.acceso) {
      var q = filtro.leccion ? "&leccion=" + filtro.leccion : "";
      api("/api/norsk-preguntas/?modo=practica" + q)
        .then(function (d) { arrancarSesion("practica", d.preguntas, filtro); })
        .catch(errorAcceso);
    } else {
      var banco = (state.demo && state.demo.preguntas) || [];
      var pool = filtro.modulo ? banco.filter(function (p) { return p.modulo === filtro.modulo; }) : banco.slice();
      arrancarSesion("practica", barajar(pool).slice(0, 10), filtro);
    }
  }

  function empezarFalladas() {
    var ids = state.prog.falladas.slice(-20);
    if (state.acceso) {
      api("/api/norsk-preguntas/?modo=practica&ids=" + encodeURIComponent(ids.join(",")))
        .then(function (d) { arrancarSesion("practica", d.preguntas, { titulo: "Repaso de falladas" }); })
        .catch(errorAcceso);
    } else {
      var banco = (state.demo && state.demo.preguntas) || [];
      var pool = banco.filter(function (p) { return ids.indexOf(p.codigo) !== -1; });
      arrancarSesion("practica", barajar(pool), { titulo: "Repaso de falladas" });
    }
  }

  function empezarSimulacro() {
    if (state.acceso) {
      api("/api/norsk-preguntas/?modo=simulacro&examen=" + state.examen)
        .then(function (d) {
          arrancarSesion("simulacro", d.preguntas, { mecanica: d.mecanica, examen: state.examen });
        })
        .catch(errorAcceso);
    } else {
      var banco = ((state.demo && state.demo.preguntas) || []).slice();
      arrancarSesion("simulacro", barajar(banco), { mecanica: MECANICA.demo, examen: "demo" });
    }
  }

  function arrancarSesion(modo, preguntas, extra) {
    if (!preguntas || !preguntas.length) {
      renderAviso("No hay preguntas disponibles todavía. Vuelve a intentarlo en un momento.");
      return;
    }
    state.sesion = {
      modo: modo,
      filtro: extra || {},
      mecanica: (extra && extra.mecanica) || null,
      examen: (extra && extra.examen) || state.examen,
      preguntas: preguntas,
      i: 0,
      respuestas: new Array(preguntas.length).fill(null),
      corregida: false,
      inicio: Date.now(),
    };
    if (modo === "simulacro") {
      persistirSimulacro();
      renderSimulacro();
    } else {
      renderPractica();
    }
  }

  function errorAcceso(e) {
    if (e && e.code === 401) {
      state.acceso = null;
      pintarEstado();
      renderAviso("Tu acceso ha caducado. Tu progreso sigue aquí; al renovar continúas donde estabas.", true);
    } else if (e && e.code === 429) {
      renderAviso("Has llegado al límite de hoy (120 sesiones). Mañana se reinicia. El examen real son 60 minutos: descansar también es preparar.");
    } else {
      renderAviso("No se pudo cargar. Revisa la conexión y prueba de nuevo.");
    }
  }

  function renderAviso(txt, conCompra) {
    limpiar();
    var s = el("section", { class: "step" });
    s.appendChild(el("button", { class: "back", text: "← Volver", onclick: renderInicio }));
    s.appendChild(el("p", { class: "intro", text: txt }));
    if (conCompra) s.appendChild(el("button", { class: "btn", text: "Renovar el acceso", onclick: renderCompra }));
    $app.appendChild(s);
  }

  // ---------- pantalla: práctica (corrección inmediata) ----------

  function renderPractica() {
    var ses = state.sesion;
    var p = ses.preguntas[ses.i];
    limpiar();

    var s = el("section", { class: "step" });
    s.appendChild(el("button", { class: "back", text: "← Salir", onclick: renderInicio }));
    var prog = el("div", { class: "progreso" });
    prog.appendChild(el("span", { text: (ses.filtro.titulo || "Práctica") + " · " + (ses.i + 1) + " de " + ses.preguntas.length }));
    s.appendChild(prog);

    s.appendChild(pintarPregunta(p, state.idioma, function (elegida, opsBtns) {
      var acierto = elegida === p.correcta;
      ses.respuestas[ses.i] = elegida;

      // stats
      var clave = ses.filtro.leccion ? "l" + ses.filtro.leccion : ses.filtro.modulo ? "m" + ses.filtro.modulo : "libre";
      var st = state.prog.temas[clave] = state.prog.temas[clave] || { vistas: 0, aciertos: 0 };
      st.vistas++; if (acierto) st.aciertos++;
      if (acierto) quitarFallada(p.codigo); else anotarFallada(p.codigo);
      guardarProg();

      opsBtns.forEach(function (b, idx) {
        b.disabled = true;
        if (idx === p.correcta) b.classList.add("acierto");
        else if (idx === elegida) b.classList.add("fallo");
      });

      var ex = el("div", { class: "explica" + (acierto ? "" : " mal"), role: "status" });
      ex.appendChild(el("p", { class: "lab", text: acierto ? "Correcto" : "No es esa" }));
      ex.appendChild(el("p", { text: p.explicacion_es }));
      if (p.fuente) ex.appendChild(el("p", { class: "src", text: p.fuente }));
      var alt = el("button", { class: "ver-idioma", text: state.idioma === "no" ? "Ver la pregunta en español" : "Se på norsk" });
      alt.addEventListener("click", function () {
        var otro = state.idioma === "no" ? "es" : "no";
        ex.parentNode.querySelector(".q-no").textContent = p["pregunta_" + otro];
        opsBtns.forEach(function (b, idx) { b.querySelector(".txt").textContent = p["opciones_" + otro][idx]; });
        alt.textContent = otro === "no" ? "Ver la pregunta en español" : "Se på norsk";
        state.idioma = otro; guardarProg();
      });
      ex.appendChild(alt);
      s.appendChild(ex);

      var sig = el("button", { class: "btn", text: ses.i + 1 < ses.preguntas.length ? "Siguiente" : "Ver el resumen" });
      sig.addEventListener("click", avanzarPractica);
      s.appendChild(sig);
      sig.focus();
      ses.corregida = true;
    }));

    $app.appendChild(s);
  }

  function avanzarPractica() {
    var ses = state.sesion;
    ses.corregida = false;
    if (ses.i + 1 < ses.preguntas.length) { ses.i++; renderPractica(); }
    else renderResumenPractica();
  }

  function renderResumenPractica() {
    var ses = state.sesion;
    var aciertos = ses.respuestas.filter(function (r, i) { return r === ses.preguntas[i].correcta; }).length;
    limpiar();
    var s = el("section", { class: "step" });
    s.appendChild(el("p", { class: "kicker", text: ses.filtro.titulo || "Práctica" }));
    s.appendChild(el("p", { class: "res-num" + (aciertos / ses.preguntas.length >= 0.75 ? "" : " mal"), text: aciertos + "/" + ses.preguntas.length }));
    s.appendChild(el("p", { class: "res-nota", text: aciertos === ses.preguntas.length
      ? "Sesión limpia. Al examen no se va sabiendo más: se va fallando menos."
      : "Cada fallo con su porqué vale más que un acierto de memoria. Repite las falladas y quedan selladas." }));
    var falladasAqui = ses.preguntas.filter(function (p, i) { return ses.respuestas[i] !== p.correcta; });
    if (falladasAqui.length) {
      s.appendChild(el("button", { class: "btn", text: "Repetir las " + falladasAqui.length + " falladas", onclick: function () {
        arrancarSesion("practica", barajar(falladasAqui.slice()), { titulo: "Repaso inmediato" });
      } }));
    }
    s.appendChild(el("button", { class: "btn ghost", text: "Otra sesión", onclick: renderTemas }));
    s.appendChild(el("button", { class: "btn ghost", text: "Volver al inicio", onclick: renderInicio }));
    $app.appendChild(s);
  }

  // Pinta enunciado + opciones. onElegir(idx, botones[]) se llama al elegir (una vez).
  function pintarPregunta(p, idioma, onElegir) {
    var frag = document.createDocumentFragment();
    var esStats = state.sesion && state.sesion.modo === "simulacro" && state.sesion.examen === "statsborger";
    var lang = esStats ? "no" : idioma;

    var q = el("p", { class: "q-no", text: p["pregunta_" + lang] });
    if (lang === "no") q.setAttribute("lang", "nb");
    frag.appendChild(q);
    if (lang === "no" && !esStats && state.sesion.modo === "practica" && idioma === "no") {
      // en práctica en noruego, la traducción aparece tras corregir (botón), no antes
    }

    var ops = el("div", { class: "ops", role: "group", "aria-label": "Opciones" });
    var botones = [];
    var elegidaYa = false;
    p["opciones_" + lang].forEach(function (o, idx) {
      var b = el("button", { class: "op" }, [
        el("span", { class: "tecla", text: String(idx + 1), "aria-hidden": "true" }),
        el("span", { class: "txt", text: o }),
      ]);
      b.addEventListener("click", function () {
        if (elegidaYa) return;
        elegidaYa = true;
        onElegir(idx, botones);
      });
      botones.push(b);
      ops.appendChild(b);
    });
    frag.appendChild(ops);

    // teclado 1/2/3 (sin modificadores: Cmd+1 cambia de pestaña, no responde preguntas)
    var handler = function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (["1", "2", "3"].indexOf(e.key) !== -1 && !elegidaYa) {
        var b = botones[parseInt(e.key, 10) - 1];
        if (b) b.click();
      }
    };
    document.addEventListener("keydown", handler, { once: false });
    // limpiar al re-render: guardamos el handler en el nodo raíz
    frag.firstChild._kbd = handler;
    setTimeout(function () {
      var obs = new MutationObserver(function () {
        if (!document.body.contains(q)) { document.removeEventListener("keydown", handler); obs.disconnect(); }
      });
      obs.observe($app, { childList: true, subtree: false });
    }, 0);

    return frag;
  }

  // ---------- pantalla: simulacro ----------

  function persistirSimulacro() {
    var ses = state.sesion;
    try {
      localStorage.setItem(LS_SIM, JSON.stringify({
        examen: ses.examen, mecanica: ses.mecanica, preguntas: ses.preguntas,
        respuestas: ses.respuestas, inicio: ses.inicio, i: ses.i,
      }));
    } catch (e) {}
  }
  function simulacroGuardado() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_SIM) || "null");
      if (!s || !s.preguntas) return null;
      return s;
    } catch (e) { return null; }
  }
  function borrarSimulacro() { try { localStorage.removeItem(LS_SIM); } catch (e) {} }

  function reanudarSimulacro(guardado) {
    state.sesion = {
      modo: "simulacro", examen: guardado.examen, mecanica: guardado.mecanica,
      preguntas: guardado.preguntas, respuestas: guardado.respuestas,
      i: Math.min(Math.max(guardado.i || 0, 0), guardado.preguntas.length - 1),
      inicio: guardado.inicio, filtro: {},
    };
    var mins = state.sesion.mecanica.minutos;
    if (Date.now() - state.sesion.inicio > mins * 60000) { entregarSimulacro(); return; }
    renderSimulacro();
  }

  var relojTimer = null;

  function renderSimulacro() {
    var ses = state.sesion;
    var p = ses.preguntas[ses.i];
    limpiar();
    if (relojTimer) { clearInterval(relojTimer); relojTimer = null; }

    var s = el("section", { class: "step" });

    var prog = el("div", { class: "progreso" });
    prog.appendChild(el("span", { text: nombreExamen(ses) + " · " + (ses.i + 1) + " de " + ses.preguntas.length }));
    var reloj = el("span", { class: "reloj", "aria-hidden": "true", text: "" });
    prog.appendChild(reloj);
    s.appendChild(prog);

    var avisoTiempo = el("p", { class: "toggle-nota", role: "status", "aria-live": "polite", text: "" });

    function tic() {
      // Si la sesión en pantalla ya no es esta, el reloj se desarma solo.
      if (state.sesion !== ses) { clearInterval(relojTimer); return; }
      var restan = ses.mecanica.minutos * 60000 - (Date.now() - ses.inicio);
      if (restan <= 0) { clearInterval(relojTimer); entregarSimulacro(); return; }
      var m = Math.floor(restan / 60000), sg = Math.floor((restan % 60000) / 1000);
      reloj.textContent = (m < 10 ? "0" : "") + m + ":" + (sg < 10 ? "0" : "") + sg;
      if (restan < 5 * 60000) reloj.classList.add("poco");
      if (Math.abs(restan - 10 * 60000) < 900) avisoTiempo.textContent = "Quedan 10 minutos.";
      if (Math.abs(restan - 2 * 60000) < 900) avisoTiempo.textContent = "Quedan 2 minutos.";
    }
    tic();
    relojTimer = setInterval(tic, 1000);

    var lang = ses.examen === "statsborger" ? "no" : state.idioma;
    var q = el("p", { class: "q-no", text: p["pregunta_" + lang] });
    if (lang === "no") q.setAttribute("lang", "nb");
    s.appendChild(q);

    var ops = el("div", { class: "ops", role: "group", "aria-label": "Opciones" });
    var botones = [];
    p["opciones_" + lang].forEach(function (o, idx) {
      var b = el("button", { class: "op" + (ses.respuestas[ses.i] === idx ? " elegida" : "") }, [
        el("span", { class: "tecla", text: String(idx + 1), "aria-hidden": "true" }),
        el("span", { class: "txt", text: o }),
      ]);
      b.addEventListener("click", function () {
        ses.respuestas[ses.i] = ses.respuestas[ses.i] === idx ? null : idx;
        persistirSimulacro();
        if (ses.respuestas[ses.i] !== null && ses.i + 1 < ses.preguntas.length) { ses.i++; renderSimulacro(); }
        else renderSimulacro();
      });
      botones.push(b);
      ops.appendChild(b);
    });
    s.appendChild(ops);
    s.appendChild(avisoTiempo);

    var kbd = function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (["1", "2", "3"].indexOf(e.key) !== -1) {
        var b = botones[parseInt(e.key, 10) - 1];
        if (b) b.click();
      }
    };
    document.addEventListener("keydown", kbd);
    var obs = new MutationObserver(function () {
      if (!document.body.contains(q)) { document.removeEventListener("keydown", kbd); obs.disconnect(); }
    });
    obs.observe($app, { childList: true });

    // rejilla de navegación
    var rej = el("div", { class: "rejilla", role: "group", "aria-label": "Ir a una pregunta" });
    ses.preguntas.forEach(function (_, idx) {
      rej.appendChild(el("button", {
        class: (ses.respuestas[idx] !== null ? "resp" : "") + (idx === ses.i ? " act" : ""),
        text: String(idx + 1),
        "aria-label": "Pregunta " + (idx + 1) + (ses.respuestas[idx] !== null ? ", respondida" : ", sin responder"),
        onclick: function () { ses.i = idx; renderSimulacro(); },
      }));
    });
    s.appendChild(rej);

    var sinResp = ses.respuestas.filter(function (r) { return r === null; }).length;
    var btnFin = el("button", { class: "btn", text: sinResp ? "Entregar (" + sinResp + " sin responder)" : "Entregar" });
    btnFin.addEventListener("click", function () {
      if (sinResp && !btnFin._confirmado) {
        btnFin._confirmado = true;
        btnFin.textContent = "¿Seguro? Pulsa otra vez para entregar";
        return;
      }
      entregarSimulacro();
    });
    s.appendChild(btnFin);
    s.appendChild(el("button", { class: "btn ghost", text: "Guardar y salir", onclick: function () { persistirSimulacro(); renderInicio(); } }));

    $app.appendChild(s);
  }

  function entregarSimulacro() {
    if (relojTimer) { clearInterval(relojTimer); relojTimer = null; }
    var ses = state.sesion;
    // Guardia: solo se entrega un simulacro vivo. Nunca borrar el guardado
    // ni corromper una práctica por una entrega fantasma.
    if (!ses || ses.modo !== "simulacro") return;
    borrarSimulacro();

    var puntuables = 0, correctasPunt = 0;
    var porModulo = { 1: { ok: 0, n: 0 }, 2: { ok: 0, n: 0 }, 3: { ok: 0, n: 0 } };
    ses.preguntas.forEach(function (p, i) {
      var ok = ses.respuestas[i] === p.correcta;
      if (!ok) anotarFallada(p.codigo); else quitarFallada(p.codigo);
      if (!p.piloto) {
        puntuables++;
        if (ok) correctasPunt++;
      }
      var m = porModulo[p.modulo] || (porModulo[p.modulo] = { ok: 0, n: 0 });
      m.n++; if (ok) m.ok++;
    });

    var mec = ses.mecanica;
    var aprobado = correctasPunt >= mec.aprobado;
    var pct = Math.round((correctasPunt / mec.puntuables) * 100);
    state.prog.simulacros.push({ fecha: new Date().toISOString().slice(0, 10), examen: ses.examen, puntos: correctasPunt, pct: pct, aprobado: aprobado });
    guardarProg();

    limpiar();
    var s = el("section", { class: "step" });
    s.appendChild(el("p", { class: "kicker", text: nombreExamen(ses) }));
    s.appendChild(el("p", { class: "res-num" + (aprobado ? "" : " mal"), text: correctasPunt + "/" + mec.puntuables }));
    s.appendChild(el("p", { class: "res-veredicto", text: aprobado ? "Aprobado." : "Todavía no." }));

    var mecTxt = ses.examen === "demo"
      ? "Este es el simulacro corto de la demo: 12 preguntas y se aprueba con 9. El examen real de la statsborgerprøven muestra 36, solo puntúan 32 (hay 4 piloto que HK-dir está probando) y apruebas con 24. El curso completo replica ese formato exacto."
      : "Has visto " + mec.total + " preguntas, pero solo " + mec.puntuables + " puntúan: " + (mec.total - mec.puntuables) + " son piloto, preguntas que HK-dir prueba y no cuentan. En el examen real no sabes cuáles son. Se aprueba con " + mec.aprobado + " de " + mec.puntuables + ".";
    var mecBox = el("div", { class: "res-mecanica" });
    mecBox.appendChild(el("p", { html: mecTxt.replace(/(\d+)/g, "<b>$1</b>") }));
    s.appendChild(mecBox);

    var des = el("div", { class: "desglose" });
    Object.keys(porModulo).forEach(function (m) {
      if (!porModulo[m].n) return;
      des.appendChild(el("div", {}, [
        el("span", { text: MODULOS[m] }),
        el("b", { text: porModulo[m].ok + "/" + porModulo[m].n }),
      ]));
    });
    s.appendChild(des);

    var falladas = ses.preguntas.filter(function (p, i) { return ses.respuestas[i] !== p.correcta; });
    if (falladas.length) {
      s.appendChild(el("button", { class: "btn", text: "Revisar las " + falladas.length + " falladas con su porqué", onclick: function () {
        arrancarSesion("practica", falladas.slice(), { titulo: "Revisión del simulacro" });
      } }));
    }
    if (!state.acceso && ses.examen === "demo") {
      s.appendChild(el("button", { class: "btn ghost", text: "Abrir el curso completo", onclick: renderCompra }));
    } else {
      s.appendChild(el("button", { class: "btn ghost", text: "Otro simulacro", onclick: empezarSimulacro }));
    }
    s.appendChild(el("button", { class: "btn ghost", text: "Volver al inicio", onclick: renderInicio }));

    // Captura de email opcional (solo demo): lead magnet para la futura newsletter.
    if (!state.acceso && ses.examen === "demo") {
      s.appendChild(capturaEmail(correctasPunt, mec.puntuables));
    }
    $app.appendChild(s);
  }

  // Captura de email opcional al terminar la demo. Consentimiento explícito.
  // Reutiliza /api/lead/ (Supabase). Sin backend configurado, degrada a "guardado" igualmente.
  function capturaEmail(aciertos, total) {
    var box = el("div", { class: "captura" });
    box.appendChild(el("h2", { text: "Guarda tu resultado" }));
    box.appendChild(el("p", { text: "Deja tu correo y guardamos cómo te ha ido. Si marcas la casilla, te escribimos cuando arranque NEXO NORUEGA: cómo funciona de verdad la vida aquí." }));

    var input = el("input", { type: "email", autocomplete: "email", placeholder: "tu@correo.com", "aria-label": "Tu correo" });
    box.appendChild(input);

    var lbl = el("label", { class: "consent" });
    var chk = el("input", { type: "checkbox" });
    lbl.appendChild(chk);
    lbl.appendChild(el("span", { text: "Quiero recibir la newsletter NEXO NORUEGA cuando arranque." }));
    box.appendChild(lbl);
    box.appendChild(el("p", { class: "consent", html: 'Tratamos tu correo para guardar tu resultado y, si lo marcas, enviarte la newsletter. Detalles en <a href="/norsk/privacidad/">privacidad</a>.' }));

    var msg = el("p", { class: "ok", role: "status", "aria-live": "polite", text: "" });
    var btn = el("button", { class: "btn", text: "Guardar mi resultado" });
    btn.addEventListener("click", function () {
      var email = (input.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Escribe un correo válido."; input.focus(); return; }
      btn.disabled = true; btn.textContent = "Guardando…";
      var params = new URLSearchParams(window.location.search);
      fetch("/api/lead/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          source: "norsk-demo",
          confianza: total ? Math.round((aciertos / total) * 100) : null,
          newsletter: chk.checked,
          utm_source: params.get("utm_source") || "",
          utm_medium: params.get("utm_medium") || "",
          utm_campaign: params.get("utm_campaign") || "norsk",
        }),
      }).then(function (r) {
        if (!r.ok) throw new Error("lead " + r.status);
        msg.textContent = "Guardado. Cuando el curso o la newsletter arranquen, te escribimos.";
        input.disabled = true; chk.disabled = true; btn.style.display = "none";
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Guardar mi resultado";
        msg.textContent = "No se pudo guardar. Prueba de nuevo en un momento.";
      });
    });
    box.appendChild(btn);
    box.appendChild(msg);
    return box;
  }

  // ---------- pantalla: lecciones ----------

  function renderLecciones() {
    limpiar();
    var s = el("section", { class: "step" });
    s.appendChild(el("button", { class: "back", text: "← Volver", onclick: renderInicio }));
    s.appendChild(el("h1", { text: "El curso" }));
    s.appendChild(el("p", { class: "intro", text: "12 lecciones que cubren el temario oficial, más la Lección 0 gratuita, la compres o no." }));

    var lista = el("div", { class: "lecciones" });
    var idx = state.lecciones.length ? state.lecciones : fallbackLecciones();

    idx.forEach(function (l) {
      var abierta = l.publica || state.acceso;
      lista.appendChild(el("button", {
        class: "leccion-item",
        onclick: function () {
          if (!abierta) { renderCompra(); return; }
          abrirLeccion(l);
        },
      }, [
        el("span", { class: "num", text: "L" + l.orden }),
        el("span", { style: "flex:1", text: l.titulo }),
        abierta ? null : el("span", { class: "cand", text: "Con el curso" }),
      ]));
    });
    s.appendChild(lista);
    $app.appendChild(s);
  }

  function fallbackLecciones() {
    var out = [{ orden: 0, slug: "leccion-0", titulo: "Qué examen necesitas y cómo se entra", publica: true }];
    for (var i = 1; i <= 12; i++) out.push({ orden: i, slug: null, titulo: "Lección " + i, publica: false });
    return out;
  }

  function abrirLeccion(l) {
    // L0 en demo: viene en el JSON público
    if (l.publica && (!l.slug || !state.acceso) && state.demo && state.demo.leccion0) {
      renderLector(state.demo.leccion0);
      return;
    }
    api("/api/norsk-leccion/?slug=" + encodeURIComponent(l.slug))
      .then(function (d) { renderLector(d.leccion); })
      .catch(errorAcceso);
  }

  function renderLector(lec) {
    limpiar();
    var s = el("section", { class: "step lector" });
    s.appendChild(el("button", { class: "back", text: "← Lecciones", onclick: renderLecciones }));
    s.appendChild(el("h1", { text: lec.titulo }));
    s.appendChild(el("div", { html: lec.cuerpo_html }));
    if (lec.vocab && lec.vocab.length) {
      var v = el("div", { class: "vocab" });
      v.appendChild(el("h3", { text: "Slik sier du det" }));
      var dl = el("dl");
      lec.vocab.forEach(function (t) {
        dl.appendChild(el("dt", { text: t.no, lang: "nb" }));
        dl.appendChild(el("dd", { text: t.es + (t.frase_a2 ? " · «" + t.frase_a2 + "»" : "") }));
      });
      v.appendChild(dl);
      s.appendChild(v);
    }
    s.appendChild(el("button", { class: "btn ghost", text: "Volver a las lecciones", onclick: renderLecciones }));
    $app.appendChild(s);
  }

  // ---------- pantalla: compra ----------

  function renderCompra() {
    limpiar();
    var s = el("section", { class: "step" });
    s.appendChild(el("button", { class: "back", text: "← Volver", onclick: renderInicio }));
    s.appendChild(el("h1", { text: "Abrir el curso completo" }));
    s.appendChild(el("p", { class: "intro", text: "Las 12 lecciones del curso, más de 400 preguntas y simulacros ilimitados de los dos exámenes. Pagas una vez y caduca solo: sin suscripción." }));

    s.appendChild(el("div", { class: "aviso", html: "¿Ya lo compraste? Entra con el enlace de tu correo o <a href=\"/norsk/acceso/\">pide que te lo reenviemos</a>." }));

    var planes = el("div", { class: "planes" });
    [["p10", "Intensivo", "249", "10 días", false],
     ["p30", "Con Calma", "349", "30 días", true],
     ["p90", "Sin Prisa", "449", "90 días", false]].forEach(function (d) {
      var plan = el("div", { class: "plan" + (d[4] ? " reco" : "") });
      plan.appendChild(el("p", { class: "n", text: d[1] + (d[4] ? " · Recomendado" : "") }));
      plan.appendChild(el("p", { class: "p", text: d[2] + " kr" }));
      plan.appendChild(el("p", { class: "d", text: d[3] + " de acceso · todo incluido" }));
      var b = el("button", { class: "btn", text: "Empezar hoy" });
      b.addEventListener("click", function () {
        b.disabled = true; b.textContent = "Abriendo el pago…";
        fetch("/api/norsk-checkout/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: d[0] }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok && res.url) { window.location.href = res.url; return; }
          throw new Error("checkout");
        }).catch(function () {
          b.disabled = false; b.textContent = "Empezar hoy";
          alert("No se pudo abrir el pago. Prueba de nuevo en unos segundos.");
        });
      });
      plan.appendChild(b);
      planes.appendChild(plan);
    });
    s.appendChild(planes);
    s.appendChild(el("p", { class: "toggle-nota", style: "margin-top:16px", text: "Garantía sin letra enana: si completas el curso, apruebas 5 simulacros y aun así suspendes, te devolvemos el dinero y sigues gratis hasta aprobar." }));
    s.appendChild(el("p", { class: "toggle-nota", html: 'Pago único, sin suscripción. <a href="/norsk/condiciones/">Condiciones y garantía</a> · <a href="/norsk/privacidad/">Privacidad</a>' }));
    $app.appendChild(s);
  }

  // Al volver de Stripe con el botón atrás (bfcache), re-render limpio
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) window.location.reload();
  });

  boot();
})();

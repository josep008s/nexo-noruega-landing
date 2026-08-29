// Larsito: práctica de conversación y comprensión oral de NEXO NORSK.
//
// Fase F0 (la actual): todo corre en el navegador. Los escenarios son guiados
// (guion fijo) y la voz usa la Web Speech API, que es gratuita y no toca servidor.
// La conversación libre con el agente real llega cuando LARSITO_ABIERTO pase a true
// y el backend tenga claves. Mismo patrón que VENTA_ABIERTA en la app de PASS.
(function () {
  "use strict";

  var LARSITO_ABIERTO = false;

  var DEMO = "/data/larsito-demo.json";
  var CLAVE = "nexo_larsito_v1";

  var app = document.getElementById("app");
  var datos = null;
  var sesion = null;
  var estado = cargarEstado();

  // ---------- Estado local ----------

  function cargarEstado() {
    try {
      var raw = localStorage.getItem(CLAVE);
      var e = raw ? JSON.parse(raw) : null;
      if (!e || typeof e !== "object") throw new Error("vacío");
      if (!e.hechos) e.hechos = {};
      if (!e.aciertos) e.aciertos = {};
      return e;
    } catch (err) {
      return { hechos: {}, aciertos: {} };
    }
  }

  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (err) { /* modo privado */ }
  }

  // ---------- Utilidades ----------

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function limpiar() { app.innerHTML = ""; }

  function botonVolver(texto, alPulsar) {
    var b = el("button", "back", "← " + texto);
    b.addEventListener("click", alPulsar);
    return b;
  }

  function onda(n) {
    var d = el("div", "onda");
    d.setAttribute("aria-hidden", "true");
    var alturas = [40, 75, 55, 100, 65, 85, 35, 70, 50];
    for (var i = 0; i < (n || alturas.length); i++) {
      var b = el("i");
      b.style.height = alturas[i % alturas.length] + "%";
      d.appendChild(b);
    }
    return d;
  }

  // ---------- Voz del navegador ----------
  // El soporte de noruego varía mucho entre navegadores, así que todo lo que
  // dependa de la voz es opcional: si no está, se practica igual escribiendo.

  var vozNo = null;
  function elegirVoz() {
    if (!("speechSynthesis" in window)) return null;
    var voces = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < voces.length; i++) {
      if (/^nb|^no/i.test(voces[i].lang || "")) return voces[i];
    }
    return null;
  }
  if ("speechSynthesis" in window) {
    vozNo = elegirVoz();
    window.speechSynthesis.onvoiceschanged = function () { vozNo = elegirVoz(); };
  }

  function decir(texto, lento) {
    if (!("speechSynthesis" in window)) return false;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(texto);
      u.lang = "nb-NO";
      u.rate = lento ? 0.72 : 0.95;
      if (vozNo) u.voice = vozNo;
      window.speechSynthesis.speak(u);
      return true;
    } catch (err) { return false; }
  }

  function reconocedor() {
    var R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return null;
    try {
      var r = new R();
      r.lang = "nb-NO";
      r.interimResults = false;
      r.maxAlternatives = 1;
      return r;
    } catch (err) { return null; }
  }

  // ---------- Pantalla: inicio ----------

  function renderInicio() {
    limpiar();
    var paso = el("div", "step");

    paso.appendChild(el("p", "kicker", "Práctica oral"));
    paso.appendChild(el("h1", null, "Larsito"));
    paso.appendChild(el("p", "intro", "Habla noruego cuando te venga bien. Larsito te da el contexto, tú respondes, y después ves cómo lo diría un noruego."));

    var aviso = el("div", "aviso");
    aviso.appendChild(el("span", "eti", "Demo"));
    var pA = el("p", null, datos && datos.aviso ? datos.aviso : "Esta es la versión de demostración: seis situaciones guiadas y seis ejercicios de escucha. La conversación libre llega con el curso.");
    aviso.appendChild(pA);
    paso.appendChild(aviso);

    paso.appendChild(el("h2", null, "Conversación"));
    var cards = el("div", "cards");
    (datos.escenarios || []).forEach(function (esc) {
      var b = el("button", "card");
      b.appendChild(el("span", "t", esc.titulo));
      b.appendChild(el("span", "m", esc.contexto_es));
      var tag = el("span", "tag" + (esc.modo === "eksamen" ? " ex" : ""),
        esc.modo === "eksamen" ? "Simulacro del examen · " + esc.nivel : "Situación real · " + esc.nivel);
      b.appendChild(tag);
      if (estado.hechos[esc.id]) {
        var hecho = el("span", "m", "Ya lo has hecho. Puedes repetirlo.");
        hecho.style.marginTop = "8px";
        b.appendChild(hecho);
      }
      b.addEventListener("click", function () { renderConversacion(esc); });
      cards.appendChild(b);
    });
    paso.appendChild(cards);

    var h2b = el("h2", null, "Comprensión oral");
    h2b.style.marginTop = "30px";
    paso.appendChild(h2b);
    var btnL = el("button", "btn ghost", "Ver los ejercicios de escucha");
    btnL.addEventListener("click", renderListening);
    paso.appendChild(btnL);

    var cierre = el("div", "cierre-panel");
    cierre.appendChild(el("p", null, "Cuando el curso abra, Larsito responde a lo que tú digas, no a un guion, y corrige lo que necesites en cada turno."));
    var a = el("a", "btn", "Avísame cuando abra");
    a.href = "https://nexonoruega.substack.com/subscribe";
    cierre.appendChild(a);
    paso.appendChild(cierre);

    app.appendChild(paso);
  }

  // ---------- Pantalla: conversación guiada ----------

  function renderConversacion(esc) {
    limpiar();
    var paso = el("div", "step");
    paso.appendChild(botonVolver("Volver", renderInicio));
    paso.appendChild(el("p", "kicker", esc.modo === "eksamen" ? "Simulacro de la prueba oral" : "Situación real"));
    paso.appendChild(el("h1", null, esc.titulo));
    paso.appendChild(el("p", "intro", esc.contexto_es));

    var chat = el("div", "chat");
    paso.appendChild(chat);

    var zona = el("div");
    paso.appendChild(zona);
    app.appendChild(paso);

    var i = 0;

    function burbujaLarsito(turno) {
      var b = el("div", "burbuja lars");
      b.appendChild(el("p", "quien", "Larsito"));
      var pno = el("p", "no", turno.larsito_no);
      pno.lang = "nb";
      b.appendChild(pno);
      var pes = el("p", "es", turno.larsito_es);
      pes.hidden = true;
      b.appendChild(pes);

      var fila = el("div", "fila-audio");
      var bEsc = el("button", "mini", "Escuchar");
      bEsc.addEventListener("click", function () {
        if (!decir(turno.larsito_no)) bEsc.textContent = "Tu navegador no tiene voz noruega";
        else { b.appendChild(onda()); setTimeout(function () { var o = b.querySelector(".onda"); if (o) o.remove(); }, 2600); }
      });
      var bLento = el("button", "mini", "Más lento");
      bLento.addEventListener("click", function () { decir(turno.larsito_no, true); });
      var bTrad = el("button", "mini", "Ver traducción");
      bTrad.addEventListener("click", function () {
        pes.hidden = !pes.hidden;
        bTrad.textContent = pes.hidden ? "Ver traducción" : "Ocultar traducción";
      });
      fila.appendChild(bEsc); fila.appendChild(bLento); fila.appendChild(bTrad);
      b.appendChild(fila);
      chat.appendChild(b);
      b.scrollIntoView({ block: "nearest" });
      return b;
    }

    function burbujaTuya(texto) {
      var b = el("div", "burbuja tu");
      b.appendChild(el("p", "quien", "Tú"));
      var p = el("p", "no", texto);
      p.lang = "nb";
      b.appendChild(p);
      chat.appendChild(b);
      return b;
    }

    function mostrarTurno() {
      zona.innerHTML = "";
      if (i >= esc.turnos.length) return terminar();

      var turno = esc.turnos[i];
      burbujaLarsito(turno);

      var caja = el("div", "responder");
      var pista = el("div", "pista");
      pista.appendChild(el("b", null, "Te toca"));
      pista.appendChild(document.createTextNode(turno.pista_es));
      caja.appendChild(pista);

      if (turno.bloques_no && turno.bloques_no.length) {
        var bl = el("div", "bloques");
        turno.bloques_no.forEach(function (x) {
          var chip = el("button", "bloque", x);
          chip.lang = "nb";
          chip.title = "Añadir al cuadro de respuesta";
          chip.addEventListener("click", function () {
            campo.value = (campo.value ? campo.value.replace(/\s*$/, " ") : "") + x;
            campo.focus();
          });
          bl.appendChild(chip);
        });
        caja.appendChild(bl);
      }

      var rec = reconocedor();
      var mic = el("button", "mic");
      mic.appendChild(el("span", "punto"));
      mic.appendChild(document.createTextNode(rec ? "Mantén pulsado y habla" : "Tu navegador no reconoce voz"));
      if (!rec) mic.disabled = true;
      caja.appendChild(mic);

      var campo = el("input", "campo");
      campo.type = "text";
      campo.lang = "nb";
      campo.placeholder = "O escribe tu respuesta en noruego";
      campo.setAttribute("aria-label", "Tu respuesta en noruego");
      caja.appendChild(campo);

      caja.appendChild(el("p", "ayuda", rec
        ? "Lo que digas aparece en el cuadro para que puedas corregirlo antes de enviarlo."
        : "El reconocimiento de voz no funciona en este navegador. Prueba en Chrome, o escribe la respuesta: se practica igual."));

      var enviar = el("button", "btn", "Responder");
      caja.appendChild(enviar);
      zona.appendChild(caja);

      if (rec) {
        var grabando = false;
        var arrancar = function (ev) {
          if (grabando) return;
          if (ev && ev.preventDefault) ev.preventDefault();
          grabando = true;
          mic.classList.add("grabando");
          mic.lastChild.nodeValue = "Escuchando…";
          try { rec.start(); } catch (err) { /* ya estaba */ }
        };
        var parar = function () {
          if (!grabando) return;
          grabando = false;
          mic.classList.remove("grabando");
          mic.lastChild.nodeValue = "Mantén pulsado y habla";
          try { rec.stop(); } catch (err) { /* nada */ }
        };
        mic.addEventListener("pointerdown", arrancar);
        mic.addEventListener("pointerup", parar);
        mic.addEventListener("pointerleave", parar);
        mic.addEventListener("pointercancel", parar);
        rec.onresult = function (e) {
          var t = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
          if (t) campo.value = t;
        };
        rec.onerror = function () {
          parar();
          campo.placeholder = "No se ha oído nada. Escribe tu respuesta.";
        };
        rec.onend = parar;
      }

      enviar.addEventListener("click", function () {
        var dicho = campo.value.trim();
        if (!dicho) { campo.focus(); return; }
        burbujaTuya(dicho);
        mostrarModelo(turno, dicho);
      });
      campo.addEventListener("keydown", function (e) { if (e.key === "Enter") enviar.click(); });
    }

    function mostrarModelo(turno, dicho) {
      zona.innerHTML = "";
      var caja = el("div", "responder");
      var t = el("div", "correccion");
      t.style.borderTop = "0";
      t.style.marginTop = "0";
      t.style.paddingTop = "0";
      t.appendChild(el("b", null, "Cómo lo diría un noruego"));
      (turno.respuestas_modelo_no || []).forEach(function (m) {
        var p = el("p", "bien", m);
        p.lang = "nb";
        p.style.marginBottom = "6px";
        t.appendChild(p);
      });
      var nota = el("p", null, "Compara con lo que has dicho. Fíjate en el orden de las palabras y en dónde cae el verbo, que es lo que más delata el nivel.");
      nota.style.marginTop = "8px";
      t.appendChild(nota);
      caja.appendChild(t);

      var oir = el("button", "btn ghost", "Escuchar el modelo");
      oir.addEventListener("click", function () {
        var m = (turno.respuestas_modelo_no || [])[0];
        if (m) decir(m);
      });
      caja.appendChild(oir);

      var seguir = el("button", "btn", i + 1 >= esc.turnos.length ? "Terminar" : "Siguiente");
      seguir.addEventListener("click", function () { i++; mostrarTurno(); });
      caja.appendChild(seguir);
      zona.appendChild(caja);
      caja.scrollIntoView({ block: "nearest" });
    }

    function terminar() {
      estado.hechos[esc.id] = true;
      guardar();
      zona.innerHTML = "";
      var caja = el("div", "responder");
      caja.appendChild(el("h2", null, "Hecho."));
      caja.appendChild(el("p", "pista", esc.modo === "eksamen"
        ? "En el examen real esto dura entre veinte y veinticinco minutos y no hay pistas en español. Por eso conviene repetirlo hasta que salga sin pensar."
        : "Repite la misma escena mañana sin mirar las pistas. Ahí es donde se gana la fluidez."));
      var otra = el("button", "btn", "Volver a las situaciones");
      otra.addEventListener("click", renderInicio);
      caja.appendChild(otra);
      zona.appendChild(caja);
    }

    mostrarTurno();
  }

  // ---------- Pantalla: comprensión oral ----------

  function renderListening() {
    limpiar();
    var paso = el("div", "step");
    paso.appendChild(botonVolver("Volver", renderInicio));
    paso.appendChild(el("p", "kicker", "Comprensión oral"));
    paso.appendChild(el("h1", null, "Escucha y responde"));
    paso.appendChild(el("p", "intro", "En la demo el audio lo lee la voz de tu navegador. En el curso son grabaciones preparadas, con el ritmo del examen."));

    (datos.listening || []).forEach(function (ej) {
      paso.appendChild(fichaListening(ej));
    });

    app.appendChild(paso);
  }

  function fichaListening(ej) {
    var caja = el("div", "ejercicio");
    caja.appendChild(el("h3", null, ej.titulo));
    caja.appendChild(el("p", "meta", ej.nivel + " · " + (ej.tema || "general")));

    var reproducir = el("button", "btn ghost", "Escuchar");
    reproducir.addEventListener("click", function () {
      if (!decir(ej.transcript_no)) reproducir.textContent = "Tu navegador no tiene voz noruega";
    });
    caja.appendChild(reproducir);

    var lento = el("button", "btn ghost", "Escuchar más despacio");
    lento.addEventListener("click", function () { decir(ej.transcript_no, true); });
    caja.appendChild(lento);

    (ej.preguntas || []).forEach(function (q, qi) {
      var pn = el("p", "pregunta-no", q.q_no);
      pn.lang = "nb";
      caja.appendChild(pn);
      caja.appendChild(el("p", "pregunta-es", q.q_es));

      var ops = el("div", "ops");
      var resuelto = false;
      (q.opciones_no || []).forEach(function (texto, oi) {
        var b = el("button", "op", texto);
        b.lang = "nb";
        b.addEventListener("click", function () {
          if (resuelto) return;
          resuelto = true;
          var botones = ops.querySelectorAll(".op");
          for (var k = 0; k < botones.length; k++) {
            botones[k].disabled = true;
            if (k === q.correcta) botones[k].classList.add("acierto");
            else if (k === oi) botones[k].classList.add("fallo");
          }
          var bien = oi === q.correcta;
          var ex = el("div", "explica" + (bien ? "" : " mal"));
          ex.appendChild(el("b", null, bien ? "Correcto" : "No es esa"));
          ex.appendChild(document.createTextNode(" " + (q.explicacion_es || "")));
          ops.parentNode.insertBefore(ex, ops.nextSibling);
          var clave = ej.codigo + ":" + qi;
          estado.aciertos[clave] = bien;
          guardar();
        });
        ops.appendChild(b);
      });
      caja.appendChild(ops);
    });

    var verT = el("button", "mini", "Ver la transcripción");
    verT.style.marginTop = "14px";
    var trans = el("div", "transcript");
    trans.hidden = true;
    var tno = el("p", "no", ej.transcript_no);
    tno.lang = "nb";
    trans.appendChild(tno);
    trans.appendChild(el("p", "es", ej.transcript_es));
    verT.addEventListener("click", function () {
      trans.hidden = !trans.hidden;
      verT.textContent = trans.hidden ? "Ver la transcripción" : "Ocultar la transcripción";
    });
    caja.appendChild(verT);
    caja.appendChild(trans);

    return caja;
  }

  // ---------- Arranque ----------

  function error(msg) {
    limpiar();
    var d = el("div", "step");
    d.appendChild(el("h1", null, "No se ha podido cargar"));
    d.appendChild(el("p", "intro", msg));
    var a = el("a", "btn", "Volver a NEXO NORSK");
    a.href = "/norsk/";
    d.appendChild(a);
    app.appendChild(d);
  }

  function arrancar() {
    // Con el agente abierto, aquí se pediría la sesión a /api/larsito-sesion/.
    // Mientras está cerrado ni se llama: la demo se sirve entera desde el JSON.
    fetch(DEMO, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (d) {
        datos = d;
        if (!datos || !Array.isArray(datos.escenarios) || !datos.escenarios.length) throw new Error("vacío");
        renderInicio();
      })
      .catch(function () {
        error("La práctica no está disponible ahora mismo. Vuelve a intentarlo en un rato.");
      });
  }

  // Con el agente abierto, primero se pide sesión al backend (que aplica el muro
  // de pago y la cuota). Si dice que no, la página cae a la demo en vez de romperse.
  if (LARSITO_ABIERTO) {
    fetch("/api/larsito-sesion/", { method: "POST", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (s) { if (s && s.ok) sesion = s; })
      .catch(function () { /* sin sesión, queda la demo */ })
      .then(arrancar);
  } else {
    arrancar();
  }
})();

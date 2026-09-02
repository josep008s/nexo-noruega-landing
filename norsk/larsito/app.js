// Larsito: práctica de conversación y comprensión oral de NEXO NORSK.
//
// Fase F0 (la actual): los escenarios son guiados y usan datos ficticios. La demo
// solo habla con una voz noruega que el navegador confirme como local. Si no la
// hay, el audio se apaga. La voz del alumno solo se admite cuando SpeechRecognition
// expone y acepta processLocally=true; en cualquier otro caso queda la escritura.
// El agente completo usa el SDK local de ElevenLabs y solo se inicia tras pulsar
// el botón, cuando LARSITO_ABIERTO pase a true y cierre sus gates.
(function () {
  "use strict";

  var LARSITO_ABIERTO = false;

  var DEMO = "/data/larsito-demo.json";
  var CLAVE = "nexo_larsito_v1";
  var aprendizaje = window.NexoLarsitoLearning || null;

  var app = document.getElementById("app");
  var datos = null;
  var estado = cargarEstado();
  var conversacion = null;
  var agenteCargando = false;
  var sdkAgentePromesa = null;
  var agenteVersion = 0;

  // ---------- Estado local ----------

  function cargarEstado() {
    try {
      var raw = localStorage.getItem(CLAVE);
      var e = raw ? JSON.parse(raw) : null;
      if (!e || typeof e !== "object") throw new Error("vacío");
      if (!e.hechos) e.hechos = {};
      if (!e.sinPistas) e.sinPistas = {};
      if (!e.aciertos) e.aciertos = {};
      e.recuperaciones = aprendizaje
        ? aprendizaje.normalizarCola(e.recuperaciones)
        : [];
      return e;
    } catch (err) {
      return { hechos: {}, sinPistas: {}, aciertos: {}, recuperaciones: [] };
    }
  }

  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (err) { /* modo privado */ }
  }

  function exportarProgreso() {
    var payload = {
      esquema: "nexo_larsito_progreso_v1",
      exportado_en: new Date().toISOString(),
      progreso: estado,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "nexo-larsito-progreso.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function borrarProgreso() {
    if (!window.confirm("¿Borrar el progreso guardado en este navegador?")) return;
    estado = { hechos: {}, sinPistas: {}, aciertos: {}, recuperaciones: [] };
    try { localStorage.removeItem(CLAVE); } catch (err) { /* modo privado */ }
    renderInicio();
  }

  // ---------- Utilidades ----------

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function cerrarConversacionActual() {
    agenteVersion += 1;
    agenteCargando = false;
    var actual = conversacion;
    conversacion = null;
    if (actual && typeof actual.endSession === "function") {
      Promise.resolve(actual.endSession()).catch(function () { /* ya desconectado */ });
    }
  }

  function limpiar() {
    cerrarConversacionActual();
    app.innerHTML = "";
  }

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

  function programarRecuperacion(focoId, fuenteId) {
    if (!aprendizaje) return false;
    try {
      estado.recuperaciones = aprendizaje.programar(
        estado.recuperaciones,
        focoId,
        fuenteId,
        new Date().toISOString(),
      );
      guardar();
      return true;
    } catch (err) { return false; }
  }

  function renderRecuperacionPendiente(paso) {
    if (!aprendizaje) return;
    var pendiente;
    try {
      pendiente = aprendizaje.primeraVencida(
        estado.recuperaciones,
        new Date().toISOString(),
      );
    } catch (err) { return; }
    if (!pendiente) return;

    var caja = el("div", "aviso recuperacion-pendiente");
    caja.appendChild(el("span", "eti", "Recuperación pendiente"));
    caja.appendChild(el("p", null,
      "Haz primero el contacto " + pendiente.contacto
      + ". Es el pendiente vencido más antiguo de tu cola local."));
    var completar = el("button", "btn ghost", "Marcar recuperación hecha");
    completar.addEventListener("click", function () {
      try {
        estado.recuperaciones = aprendizaje.completarVencida(
          estado.recuperaciones,
          pendiente.recovery_id,
          new Date().toISOString(),
        );
        guardar();
        renderInicio();
      } catch (err) { /* la cola cambio; se recalcula al volver */ }
    });
    caja.appendChild(completar);
    paso.appendChild(caja);
  }

  // ---------- Voz del navegador ----------
  // El soporte de noruego varía mucho entre navegadores, así que todo lo que
  // dependa de la voz es opcional: si no está, se practica igual escribiendo.
  // Regla de honestidad: aquí NUNCA se habla con una voz que no sea noruega.
  // Leer bokmål con una voz española enseña una pronunciación falsa, y eso es
  // peor que el silencio.

  var vozNo = null;
  function elegirVoz() {
    if (!("speechSynthesis" in window)) return null;
    var voces = window.speechSynthesis.getVoices() || [];
    var mejor = null;
    var mejorPuntos = -1;
    for (var i = 0; i < voces.length; i++) {
      var v = voces[i];
      if (!/^(nb|no)(-|$)/i.test(v.lang || "")) continue;
      // La demo no manda texto a un proveedor de voz. Una voz solo es apta si
      // el navegador confirma a la vez idioma noruego y servicio local.
      if (v.localService !== true) continue;
      var puntos = 0;
      if (/nora/i.test(v.name || "")) puntos += 2;
      if (puntos > mejorPuntos) { mejor = v; mejorPuntos = puntos; }
    }
    return mejor;
  }
  if ("speechSynthesis" in window) {
    vozNo = elegirVoz();
    window.speechSynthesis.onvoiceschanged = function () {
      var teniaVoz = !!vozNo;
      vozNo = elegirVoz();
      if (!teniaVoz && vozNo) restaurarEscuchaLocal();
    };
  }

  function decir(texto, lento, alDone) {
    // Sin voz noruega no se habla: nada de caer a la voz por defecto.
    if (!vozNo) return false;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(texto);
      u.lang = "nb-NO";
      u.rate = lento ? 0.72 : 0.95;
      u.voice = vozNo;
      var cerrar = function () {
        if (sonando && sonando.u === u) sonando = null;
        if (alDone) alDone();
      };
      u.onend = cerrar; u.onerror = cerrar;
      sonando = { texto: texto, lento: !!lento, alDone: alDone, u: u };
      window.speechSynthesis.speak(u);
      return true;
    } catch (err) { return false; }
  }

  function hayVoz() { return !!vozNo; }

  // ---------- Un solo audio a la vez ----------
  // Antes de sonar nada se para lo anterior; pulsar lo que ya suena lo detiene.

  var sonando = null; // { texto, lento, alDone, u }

  function pararAudio() {
    var s = sonando;
    sonando = null;
    try { window.speechSynthesis.cancel(); } catch (err) {}
    if (s && s.alDone) s.alDone();
  }

  // Capa única de escucha local. Devuelve false sin voz apta y "parado" cuando
  // la pulsación detiene lo que ya sonaba.
  function hablar(texto, lento, alDone) {
    if (sonando && sonando.texto === texto && sonando.lento === !!lento) {
      pararAudio();
      return "parado";
    }
    pararAudio();
    return decir(texto, lento, alDone);
  }

  // Aviso honesto cuando no hay voz local noruega. La línea larga se muestra
  // solo la primera vez; los botones se apagan siempre.
  var avisoVozDado = false;
  function avisarSinVoz(contenedor) {
    if (avisoVozDado) return;
    avisoVozDado = true;
    var aviso = el("p", "ayuda", "Tu navegador no tiene voz noruega instalada y el audio se apaga para no enseñarte una pronunciación falsa. La conversación por escrito funciona igual.");
    aviso.setAttribute("data-aviso-voz-local", "true");
    contenedor.appendChild(aviso);
  }

  function apagarEscucha(principal, secundario, contenedor) {
    if (!principal.hasAttribute("data-voz-bloqueada")) {
      principal.setAttribute("data-voz-bloqueada", "true");
      principal.setAttribute("data-voz-texto", principal.textContent);
    }
    principal.disabled = true;
    principal.textContent = "Sin voz noruega en este navegador";
    if (secundario) {
      secundario.setAttribute("data-voz-secundaria", "true");
      secundario.disabled = true;
      secundario.hidden = true;
    }
    avisarSinVoz(contenedor);
  }

  function restaurarEscuchaLocal() {
    var principales = app.querySelectorAll('[data-voz-bloqueada="true"]');
    for (var i = 0; i < principales.length; i++) {
      var principal = principales[i];
      principal.disabled = false;
      principal.textContent = principal.getAttribute("data-voz-texto") || "Escuchar";
      principal.removeAttribute("data-voz-bloqueada");
      principal.removeAttribute("data-voz-texto");
    }
    var secundarios = app.querySelectorAll('[data-voz-secundaria="true"]');
    for (var j = 0; j < secundarios.length; j++) {
      secundarios[j].disabled = false;
      secundarios[j].hidden = false;
      secundarios[j].removeAttribute("data-voz-secundaria");
    }
    var avisos = app.querySelectorAll('[data-aviso-voz-local="true"]');
    for (var k = 0; k < avisos.length; k++) avisos[k].remove();
    avisoVozDado = false;
  }

  function reconocedor() {
    var R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return null;
    try {
      var r = new R();
      if (!("processLocally" in r)) return null;
      r.processLocally = true;
      if (r.processLocally !== true) return null;
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
    paso.appendChild(el("p", "intro", "Practica noruego con situaciones guiadas. Larsito te da el contexto, tú respondes y después comparas tu frase con un modelo."));

    var aviso = el("div", "aviso");
    aviso.appendChild(el("span", "eti", "Demo"));
    var pA = el("p", null, datos && datos.aviso ? datos.aviso : "Esta es la versión de demostración: seis situaciones guiadas y seis ejercicios de escucha. La conversación libre llega con el curso.");
    aviso.appendChild(pA);
    paso.appendChild(aviso);

    renderRecuperacionPendiente(paso);

    if (LARSITO_ABIERTO) renderAgente(paso);

    paso.appendChild(el("h2", null, "Conversación"));
    var cards = el("div", "cards");
    (datos.escenarios || []).forEach(function (esc) {
      var b = el("button", "card");
      b.appendChild(el("span", "t", esc.titulo));
      b.appendChild(el("span", "m", esc.contexto_es));
      var tag = el("span", "tag" + (esc.modo === "eksamen" ? " ex" : ""),
        esc.modo === "eksamen" ? "Simulacro sin evaluación · " + esc.nivel : "Role-play ficticio · " + esc.nivel);
      b.appendChild(tag);
      if (estado.hechos[esc.id]) {
        var hecho = el("span", "m", estado.sinPistas && estado.sinPistas[esc.id]
          ? "Dos vueltas hechas; la segunda, sin bloques ni pistas de respuesta."
          : "Ya lo has hecho. El siguiente paso es repetirlo con menos apoyo.");
        hecho.style.marginTop = "8px";
        b.appendChild(hecho);
      }
      b.addEventListener("click", function () {
        if (agenteCargando) return;
        renderConversacion(esc);
      });
      cards.appendChild(b);
    });
    paso.appendChild(cards);

    var h2b = el("h2", null, "Comprensión oral");
    h2b.style.marginTop = "30px";
    paso.appendChild(h2b);
    var btnL = el("button", "btn ghost", "Ver los ejercicios de escucha");
    btnL.addEventListener("click", function () {
      if (agenteCargando) return;
      renderListening();
    });
    paso.appendChild(btnL);

    var cierre = el("div", "cierre-panel");
    cierre.appendChild(el("p", null, "Cuando el curso abra, Larsito responderá a lo que digas, no a un guion. El feedback llegará después de la actuación completa."));
    var a = el("a", "btn", "Avísame cuando abra");
    a.href = "https://nexonoruega.substack.com/subscribe";
    cierre.appendChild(a);
    paso.appendChild(cierre);

    var datosLocales = el("div", "cierre-panel datos-locales");
    datosLocales.appendChild(el("h2", null, "Tu progreso local"));
    datosLocales.appendChild(el("p", null, "Este navegador guarda solo qué prácticas has completado y tus aciertos. No guarda tus respuestas escritas ni transcripciones."));
    var exportar = el("button", "btn ghost", "Exportar progreso");
    exportar.addEventListener("click", exportarProgreso);
    datosLocales.appendChild(exportar);
    var borrar = el("button", "btn ghost", "Borrar progreso");
    borrar.addEventListener("click", borrarProgreso);
    datosLocales.appendChild(borrar);
    paso.appendChild(datosLocales);

    app.appendChild(paso);
  }

  // ---------- Agente completo ----------
  // El SDK llega en un bundle local (ElevenLabsClient). La clave de ElevenLabs
  // y la JWT interna nunca llegan al navegador: el endpoint devuelve solo el
  // signed URL temporal del proveedor.

  function cargarSdkAgente() {
    if (window.ElevenLabsClient && window.ElevenLabsClient.Conversation) {
      return Promise.resolve(window.ElevenLabsClient);
    }
    if (sdkAgentePromesa) return sdkAgentePromesa;
    sdkAgentePromesa = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/norsk/larsito/vendor/elevenlabs-client-1.23.0.iife.js";
      s.async = true;
      s.onload = function () {
        if (window.ElevenLabsClient && window.ElevenLabsClient.Conversation) resolve(window.ElevenLabsClient);
        else reject(new Error("sdk"));
      };
      s.onerror = function () { reject(new Error("sdk")); };
      document.head.appendChild(s);
    }).catch(function (err) {
      sdkAgentePromesa = null;
      throw err;
    });
    return sdkAgentePromesa;
  }

  function renderAgente(paso) {
    var caja = el("div", "cierre-panel agente-panel");
    caja.appendChild(el("h2", null, "Práctica con Larsito"));
    caja.appendChild(el("p", null, "Elige conversación libre o simulacro. La conversación se transmite al proveedor de voz para que Larsito pueda responderte; no se guarda en el progreso local."));

    var etiquetaModo = el("label", "ayuda", "Tipo de práctica");
    var selectorModo = document.createElement("select");
    selectorModo.setAttribute("aria-label", "Tipo de práctica con Larsito");
    var opcionLibre = document.createElement("option");
    opcionLibre.value = "FREE_CONVERSATION";
    opcionLibre.textContent = "Conversación libre";
    var opcionExamen = document.createElement("option");
    opcionExamen.value = "EXAM_SIMULATION";
    opcionExamen.textContent = "Simulacro de formato similar";
    selectorModo.appendChild(opcionLibre);
    selectorModo.appendChild(opcionExamen);
    etiquetaModo.appendChild(selectorModo);
    caja.appendChild(etiquetaModo);

    var estadoAgente = el("p", "ayuda", "Listo para empezar.");
    estadoAgente.setAttribute("role", "status");
    caja.appendChild(estadoAgente);

    var transcripcion = el("div", "chat agente-chat");
    transcripcion.setAttribute("aria-live", "polite");
    caja.appendChild(transcripcion);

    var iniciar = el("button", "btn", "Iniciar conversación");
    var parar = el("button", "btn ghost", "Terminar conversación");
    parar.hidden = true;
    caja.appendChild(iniciar);
    caja.appendChild(parar);
    paso.appendChild(caja);

    var intentoExamen = null;

    function uuidNuevo() {
      if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
        throw new Error("navegador");
      }
      return window.crypto.randomUUID();
    }

    function obtenerIntentoExamen() {
      if (!intentoExamen) {
        intentoExamen = {
          attempt_id: uuidNuevo(),
          requests: { A: uuidNuevo(), B: uuidNuevo(), C: uuidNuevo() },
          estimulos: {},
        };
      }
      return intentoExamen;
    }

    async function pedirEstimuloEx(tarea) {
      var intento = obtenerIntentoExamen();
      if (intento.estimulos[tarea]) return intento.estimulos[tarea];
      var respuesta = await fetch("/api/larsito-estimulo/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruta: "norskproven-b1-v1",
          tarea: tarea,
          attempt_id: intento.attempt_id,
          request_id: intento.requests[tarea],
        }),
      });
      var body = await respuesta.json();
      if (!respuesta.ok || !body || body.ok !== true
          || body.ruta !== "norskproven-b1-v1"
          || body.tarea !== tarea
          || typeof body.stimulus_id !== "string") {
        throw new Error((body && body.error) || "estimulo");
      }
      intento.estimulos[tarea] = body.stimulus_id;
      return body.stimulus_id;
    }

    async function variablesDinamicas() {
      if (selectorModo.value !== "EXAM_SIMULATION") {
        return { modo: "FREE_CONVERSATION" };
      }
      setEstado("Reservando estímulos inéditos…");
      // El orden A-B-C permite al servidor impedir combinaciones incompatibles.
      var a = await pedirEstimuloEx("A");
      var b = await pedirEstimuloEx("B");
      var c = await pedirEstimuloEx("C");
      return {
        modo: "EXAM_SIMULATION",
        ruta: "norskproven-b1-v1",
        tarea: "ABC",
        stimulus_id: [a, b, c].join(","),
        stimulus_a: a,
        stimulus_b: b,
        stimulus_c: c,
      };
    }

    function setEstado(texto) { estadoAgente.textContent = texto; }
    function mensaje(m) {
      if (!m || typeof m.message !== "string" || !m.message.trim()) return;
      var quien = m.role === "user" || m.source === "user" ? "Tú" : "Larsito";
      var b = el("div", "burbuja " + (quien === "Tú" ? "tu" : "lars"));
      b.appendChild(el("p", "quien", quien));
      var p = el("p", "no", m.message);
      p.lang = "nb";
      b.appendChild(p);
      transcripcion.appendChild(b);
      b.scrollIntoView({ block: "nearest" });
    }
    function restaurarBotones() {
      iniciar.disabled = false;
      iniciar.hidden = false;
      parar.hidden = true;
      selectorModo.disabled = false;
      agenteCargando = false;
    }

    async function terminarAgente() {
      var actual = conversacion;
      conversacion = null;
      if (actual) {
        try { await actual.endSession(); } catch (err) { /* ya desconectado */ }
      }
      setEstado("Conversación terminada.");
      restaurarBotones();
    }

    async function iniciarAgente() {
      if (agenteCargando || conversacion) return;
      var version = agenteVersion;
      agenteCargando = true;
      iniciar.disabled = true;
      selectorModo.disabled = true;
      try {
        await cargarSdkAgente();
        if (version !== agenteVersion) return;
        if (!window.ElevenLabsClient || !window.ElevenLabsClient.Conversation) {
          throw new Error("sdk");
        }
        const dinamicas = await variablesDinamicas();
        if (version !== agenteVersion) return;
        setEstado("Pidiendo una conexión segura…");
        const respuesta = await fetch("/api/larsito-sesion/", {
          method: "POST",
          credentials: "same-origin",
        });
        const sesion = await respuesta.json();
        if (version !== agenteVersion) return;
        if (!respuesta.ok || !sesion || sesion.ok !== true || typeof sesion.signed_url !== "string") {
          throw new Error((sesion && sesion.error) || "sesion");
        }
        setEstado("Conectando…");
        const nuevaConversacion = await window.ElevenLabsClient.Conversation.startSession({
          signedUrl: sesion.signed_url,
          dynamicVariables: dinamicas,
          clientTools: {
            programar_recuperacion: function (parametros) {
              var foco = parametros && parametros.focus_id;
              var fuente = parametros && parametros.source_id;
              return programarRecuperacion(foco, fuente)
                ? "SCHEDULED_1_3_7_14"
                : "REJECTED_INVALID_IDS";
            },
          },
          onConnect: function () {
            setEstado("Conectado. Te escucha Larsito.");
            iniciar.hidden = true;
            parar.hidden = false;
            if (dinamicas.modo === "EXAM_SIMULATION") intentoExamen = null;
            agenteCargando = false;
          },
          onDisconnect: function () {
            conversacion = null;
            setEstado("Conexión terminada.");
            restaurarBotones();
          },
          onError: function () { setEstado("La conexión de voz ha fallado. Puedes intentarlo de nuevo."); },
          onModeChange: function (modo) {
            if (modo && modo.mode === "speaking") setEstado("Larsito está hablando…");
            else if (modo && modo.mode === "listening") setEstado("Te escucha Larsito.");
          },
          onMessage: mensaje,
        });
        if (version !== agenteVersion) {
          try { await nuevaConversacion.endSession(); } catch (err) { /* ya desconectado */ }
          return;
        }
        conversacion = nuevaConversacion;
      } catch (err) {
        if (version !== agenteVersion) return;
        conversacion = null;
        setEstado(err && err.message === "acceso"
          ? "Necesitas un acceso activo al curso para usar la conversación completa."
          : "No se ha podido iniciar la conversación. La demo sigue disponible.");
        restaurarBotones();
      }
    }

    iniciar.addEventListener("click", iniciarAgente);
    parar.addEventListener("click", terminarAgente);
  }

  // ---------- Pantalla: conversación guiada ----------

  function renderConversacion(esc, sinPistas) {
    limpiar();
    var paso = el("div", "step");
    paso.appendChild(botonVolver("Volver", renderInicio));
    paso.appendChild(el("p", "kicker", esc.modo === "eksamen" ? "Simulacro sin evaluación" : "Role-play ficticio"));
    paso.appendChild(el("h1", null, esc.titulo));
    paso.appendChild(el("p", "intro", esc.contexto_es));
    if (esc.datos_ficticios_es) {
      var fichaFicticia = el("div", "aviso datos-ficticios");
      fichaFicticia.appendChild(el("span", "eti", "Ficha ficticia"));
      fichaFicticia.appendChild(el("p", null, esc.datos_ficticios_es));
      paso.appendChild(fichaFicticia);
    }

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
      var bLento = el("button", "mini", "Más lento");
      var quitarOnda = function () {
        var o = b.querySelector(".onda"); if (o) o.remove();
        bEsc.textContent = "Escuchar";
      };
      bEsc.addEventListener("click", function () {
        var r = hablar(turno.larsito_no, false, quitarOnda);
        if (!r) { apagarEscucha(bEsc, bLento, b); return; }
        if (r === "parado") return; // quitarOnda ya ha restaurado el botón
        bEsc.textContent = "Parar";
        if (!b.querySelector(".onda")) b.appendChild(onda());
      });
      bLento.addEventListener("click", function () {
        if (!hablar(turno.larsito_no, true, quitarOnda)) apagarEscucha(bEsc, bLento, b);
      });
      var bTrad = el("button", "mini", "Ver traducción");
      bTrad.addEventListener("click", function () {
        pes.hidden = !pes.hidden;
        bTrad.textContent = pes.hidden ? "Ver traducción" : "Ocultar traducción";
      });
      fila.appendChild(bEsc); fila.appendChild(bLento); fila.appendChild(bTrad);
      b.appendChild(fila);
      if (!hayVoz()) apagarEscucha(bEsc, bLento, b);
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
      pista.appendChild(document.createTextNode(sinPistas
        ? "Sin bloques ni pistas de respuesta. Usa solo la ficha ficticia que encabeza la escena."
        : turno.pista_es));
      caja.appendChild(pista);

      if (!sinPistas && turno.bloques_no && turno.bloques_no.length) {
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
          if (hayVoz()) {
            var oirChip = el("button", "bloque-oir", "♪");
            oirChip.setAttribute("aria-label", "Escuchar: " + x);
            oirChip.title = "Escuchar cómo suena";
            oirChip.addEventListener("click", function () { hablar(x); });
            bl.appendChild(oirChip);
          }
        });
        caja.appendChild(bl);
      }

      var rec = reconocedor();
      var mic = null;
      if (rec) {
        mic = el("button", "mic");
        mic.appendChild(el("span", "punto"));
        mic.appendChild(document.createTextNode("Mantén pulsado y habla"));
        caja.appendChild(mic);
      }

      var campo = el("input", "campo");
      campo.type = "text";
      campo.lang = "nb";
      campo.placeholder = "O escribe tu respuesta en noruego";
      campo.setAttribute("aria-label", "Tu respuesta en noruego");
      caja.appendChild(campo);

      caja.appendChild(el("p", "ayuda", rec
        ? "El navegador ha confirmado el procesamiento local. La transcripción solo aparece en el cuadro: no se sube ni se guarda en el progreso."
        : "Este navegador no garantiza reconocimiento local, así que el micrófono no se muestra. Escribe una respuesta ficticia: se practica igual."));

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
      t.appendChild(el("b", null, "Modelo para comparar"));
      (turno.respuestas_modelo_no || []).forEach(function (m) {
        var p = el("p", "bien", m);
        p.lang = "nb";
        p.style.marginBottom = "6px";
        t.appendChild(p);
      });
      var nota = el("p", null, "Compara con lo que has dicho. Fíjate en el orden de las palabras y en dónde cae el verbo: esos cambios pueden hacer la frase más clara.");
      nota.style.marginTop = "8px";
      t.appendChild(nota);
      caja.appendChild(t);

      var oir = el("button", "btn ghost", "Escuchar el modelo");
      oir.addEventListener("click", function () {
        var m = (turno.respuestas_modelo_no || [])[0];
        if (m && !hablar(m)) apagarEscucha(oir, null, caja);
      });
      caja.appendChild(oir);
      if (!hayVoz()) apagarEscucha(oir, null, caja);

      var seguir = el("button", "btn", i + 1 >= esc.turnos.length ? "Terminar" : "Siguiente");
      seguir.addEventListener("click", function () { i++; mostrarTurno(); });
      caja.appendChild(seguir);
      zona.appendChild(caja);
      caja.scrollIntoView({ block: "nearest" });
    }

    function terminar() {
      estado.hechos[esc.id] = true;
      if (sinPistas) {
        estado.sinPistas[esc.id] = true;
        programarRecuperacion("DEMO:" + esc.id, esc.id);
      }
      guardar();
      zona.innerHTML = "";
      var caja = el("div", "responder");
      caja.appendChild(el("h2", null, sinPistas ? "Segunda vuelta completada." : "Hecho."));
      caja.appendChild(el("p", "pista", sinPistas
        ? "Has retirado los bloques y las pistas de respuesta, pero conservas la ficha y el tema. Esto no demuestra transferencia ni reproduce o evalúa la prueba real. El siguiente paso sería practicar la misma función con datos ficticios nuevos."
        : (esc.modo === "eksamen"
          ? "Esto ha sido una práctica guiada, no una reproducción ni una evaluación de la prueba real. Repite la función con otra ficha ficticia y menos apoyo."
          : "Repite la función otro día con datos ficticios nuevos y menos apoyo.")));
      if (!sinPistas) {
        var sinP = el("button", "btn", "Repítelo con menos apoyo");
        sinP.addEventListener("click", function () { renderConversacion(esc, true); });
        caja.appendChild(sinP);
      }
      var otra = el("button", "btn" + (sinPistas ? "" : " ghost"), "Volver a las situaciones");
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
    paso.appendChild(el("p", "intro", LARSITO_ABIERTO
      ? "Escucha las grabaciones preparadas del curso y responde a sus preguntas."
      : "Si tu dispositivo tiene una voz noruega local, puede leer el texto sintéticamente. Las grabaciones del curso están preparadas para sus tareas concretas."));
    app.appendChild(paso);

    if (!LARSITO_ABIERTO) {
      (datos.listening || []).forEach(function (ej) { paso.appendChild(fichaListening(ej, false)); });
      return;
    }

    var cargando = el("p", "ayuda", "Cargando las grabaciones…");
    var tandas = el("div");
    var siguiente = el("button", "btn ghost", "Siguiente tanda");
    var fin = el("p", "ayuda", "Has llegado al final de las grabaciones B1 disponibles.");
    siguiente.hidden = true;
    fin.hidden = true;
    paso.appendChild(cargando);
    paso.appendChild(tandas);
    paso.appendChild(siguiente);
    paso.appendChild(fin);

    var cursorSiguiente = null;
    var cargandoTanda = false;
    var vistos = new Set();
    var numeroTanda = 0;

    function cargarTanda(cursor) {
      if (cargandoTanda) return;
      cargandoTanda = true;
      siguiente.disabled = true;
      siguiente.hidden = true;
      fin.hidden = true;
      cargando.hidden = false;
      cargando.textContent = numeroTanda
        ? "Cargando la siguiente tanda…"
        : "Cargando las grabaciones…";

      var url = "/api/larsito-listening/?nivel=B1";
      if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

      fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.json().then(function (d) { return { respuesta: r, datos: d }; }); })
        .then(function (resultado) {
          var r = resultado.respuesta;
          var d = resultado.datos;
          if (!r.ok || !d || d.ok !== true || !Array.isArray(d.ejercicios)) {
            throw new Error((d && d.error) || "listening");
          }
          if (!d.ejercicios.length || d.ejercicios.length > 10 || typeof d.has_more !== "boolean") {
            throw new Error("pagina");
          }
          if (d.has_more
              && (typeof d.next_cursor !== "string"
                || !/^[A-Z0-9_-]{3,40}$/.test(d.next_cursor)
                || d.next_cursor === cursor)) {
            throw new Error("cursor");
          }

          var codigos = new Set();
          d.ejercicios.forEach(function (ej) {
            if (!ej || typeof ej.codigo !== "string"
                || !/^[A-Z0-9_-]{3,40}$/.test(ej.codigo)
                || vistos.has(ej.codigo) || codigos.has(ej.codigo)) {
              throw new Error("pagina_repetida");
            }
            codigos.add(ej.codigo);
          });

          numeroTanda += 1;
          d.ejercicios.forEach(function (ej) {
            vistos.add(ej.codigo);
            tandas.appendChild(fichaListening(ej, true));
          });
          cursorSiguiente = d.has_more ? d.next_cursor : null;
          cargandoTanda = false;
          cargando.hidden = true;
          siguiente.disabled = false;
          siguiente.hidden = !cursorSiguiente;
          fin.hidden = !!cursorSiguiente;
        })
        .catch(function () {
          cargandoTanda = false;
          cargando.hidden = false;
          cargando.textContent = "No se han podido cargar las grabaciones. Vuelve a intentarlo en un momento.";
          // Si fallo una pagina posterior, conserva el mismo cursor para que el
          // boton reintente esa tanda y no salte ni repita la anterior.
          if (cursor) {
            cursorSiguiente = cursor;
            siguiente.disabled = false;
            siguiente.hidden = false;
          }
        });
    }

    siguiente.addEventListener("click", function () {
      if (cursorSiguiente) cargarTanda(cursorSiguiente);
    });
    cargarTanda(null);
  }

  function fichaListening(ej, remoto) {
    var caja = el("div", "ejercicio");
    caja.appendChild(el("h3", null, ej.titulo));
    caja.appendChild(el("p", "meta", ej.nivel + " · " + (ej.tema || "general")));

    if (remoto) {
      if (typeof ej.audio_url === "string" && ej.audio_url) {
        var audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = ej.audio_url;
        audio.setAttribute("aria-label", "Grabación de " + ej.titulo);
        caja.appendChild(audio);
      } else {
        caja.appendChild(el("p", "ayuda", "Esta grabación no está disponible ahora mismo."));
      }
    } else {
      var reproducir = el("button", "btn ghost", "Escuchar");
      var lento = el("button", "btn ghost", "Escuchar más despacio");
      reproducir.addEventListener("click", function () {
        if (!hablar(ej.transcript_no)) apagarEscucha(reproducir, lento, caja);
      });
      lento.addEventListener("click", function () {
        if (!hablar(ej.transcript_no, true)) apagarEscucha(reproducir, lento, caja);
      });
      caja.appendChild(reproducir);
      caja.appendChild(lento);
      if (!hayVoz()) apagarEscucha(reproducir, lento, caja);
    }

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
    // La demo se sirve entera desde el JSON. La sesión del agente se pide solo
    // al pulsar "Iniciar conversación", para no reservar una conversación sin
    // que la persona haya decidido empezar.
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

  arrancar();
})();

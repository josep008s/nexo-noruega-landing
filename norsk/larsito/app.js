// Larsito: práctica de conversación y comprensión oral de NEXO NORSK.
//
// Fase F0 (la actual): los escenarios son guiados y usan datos ficticios. La demo
// habla con grabaciones fijas de voz noruega real servidas desde este dominio y,
// para lo que no tiene grabación, con una voz noruega que el navegador confirme
// como local. Si no hay ninguna de las dos, el audio se apaga. La voz del alumno solo se admite cuando SpeechRecognition
// expone y acepta processLocally=true; en cualquier otro caso queda la escritura.
// El agente completo usa el SDK local de ElevenLabs y solo se inicia tras pulsar
// el botón, cuando LARSITO_ABIERTO pase a true y cierre sus gates.
(function () {
  "use strict";

  var LARSITO_ABIERTO = false;

  var DEMO = "/data/larsito-demo.json";
  var INDICE_CUADERNO = "/data/norsk-cuaderno-indice.json";
  var APRENDIZAJE = "/api/larsito-aprendizaje/";
  var CLAVE = "nexo_larsito_v1";
  var MAX_INFORMES_LOCALES = 10;
  // Audio fijo de la demo (grabaciones servidas desde este dominio, sin proveedor en vivo).
  var audioEstatico = {};
  var indiceCuaderno = null;
  // Limpiezas de la pantalla actual (grabaciones locales, cronómetros).
  var limpiezas = [];
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
      if (!Array.isArray(e.informes)) e.informes = [];
      e.recuperaciones = aprendizaje
        ? aprendizaje.normalizarCola(e.recuperaciones)
        : [];
      return e;
    } catch (err) {
      return { hechos: {}, sinPistas: {}, aciertos: {}, recuperaciones: [], informes: [] };
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
    while (limpiezas.length) { try { limpiezas.pop()(); } catch (err) { /* nada que liberar */ } }
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
      sincronizarRecuperaciones();
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
    var escPendiente = escenarioPorId(pendiente.source_id);
    if (escPendiente) {
      var ahoraBtn = el("button", "btn", "Hacerla ahora, en cinco minutos");
      ahoraBtn.addEventListener("click", function () { renderConversacion(escPendiente, true, true); });
      caja.insertBefore(ahoraBtn, completar);
    }
    var ics = el("button", "btn ghost", "Llevar los repasos al calendario");
    ics.addEventListener("click", descargarCalendario);
    caja.appendChild(ics);
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
    var fijo = audioEstatico[texto];
    if (fijo) return reproducirFijo(fijo, texto, lento, alDone);
    // Sin grabación fija y sin voz noruega local no se habla: nada de caer a la voz por defecto.
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

  // Grabaciones fijas: un mp3 por frase, servido desde nexonoruega.com. La versión
  // lenta baja la velocidad sin cambiar el tono (preservesPitch) para que la
  // pronunciación siga siendo la de la voz real.
  function reproducirFijo(url, texto, lento, alDone) {
    try {
      var a = new Audio(url);
      a.preload = "auto";
      a.playbackRate = lento ? 0.78 : 1;
      if ("preservesPitch" in a) a.preservesPitch = true;
      var cerrar = function () {
        if (sonando && sonando.audio === a) sonando = null;
        if (alDone) alDone();
      };
      a.onended = cerrar; a.onerror = cerrar;
      sonando = { texto: texto, lento: !!lento, alDone: alDone, audio: a };
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(cerrar);
      return true;
    } catch (err) { return false; }
  }

  function hayVoz() { return !!vozNo; }
  function hayVozPara(texto) { return !!audioEstatico[texto] || !!vozNo; }

  // ---------- Un solo audio a la vez ----------
  // Antes de sonar nada se para lo anterior; pulsar lo que ya suena lo detiene.

  var sonando = null; // { texto, lento, alDone, u }

  function pararAudio() {
    var s = sonando;
    sonando = null;
    try { window.speechSynthesis.cancel(); } catch (err) {}
    if (s && s.audio) { try { s.audio.pause(); s.audio.currentTime = 0; } catch (err) {} }
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
    renderRondaCorta(paso);

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
    a.href = "https://nexonoruega.substack.com/subscribe?utm_source=nexonoruega.com&utm_medium=web&utm_campaign=norsk-larsito";
    cierre.appendChild(a);
    paso.appendChild(cierre);

    renderRecorrido(paso);

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

    var informeCaja = el("div", "informe");
    informeCaja.hidden = true;
    caja.appendChild(informeCaja);

    var iniciar = el("button", "btn", "Iniciar conversación");
    var parar = el("button", "btn ghost", "Terminar conversación");
    parar.hidden = true;
    caja.appendChild(iniciar);
    caja.appendChild(parar);
    paso.appendChild(caja);

    var intentoExamen = null;
    var cronoAgente = null;
    var sesionId = null;

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
      informeCaja.hidden = true;
      informeCaja.innerHTML = "";
      try { sesionId = uuidNuevo(); } catch (err) { sesionId = "sesion-" + Date.now(); }
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
        setEstado("Recordando tus últimas sesiones…");
        Object.assign(dinamicas, await perfilParaAgente());
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
            registrar_informe: function (parametros) {
              var inf = normalizarInforme(parametros, dinamicas, sesionId);
              if (!inf) return "REJECTED_INVALID_FIELDS";
              mostrarInforme(informeCaja, inf);
              guardarInformeLocal(inf);
              enviarInforme(inf);
              return "SAVED";
            },
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
            if (dinamicas.modo === "EXAM_SIMULATION") {
              intentoExamen = null;
              cronoAgente = cronometro("Orientación de la prueba real: calentamiento 1 a 2 min · tarea A 2 a 3 min · tarea B 5 a 7 min · tarea C 2 a 3 min · unos 20 a 25 min en total.");
              caja.insertBefore(cronoAgente, transcripcion);
            }
            agenteCargando = false;
          },
          onDisconnect: function () {
            conversacion = null;
            pararCronometro(cronoAgente);
            cronoAgente = null;
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

  function renderConversacion(esc, sinPistas, rondaCorta) {
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

    if (rondaCorta) paso.insertBefore(cuentaAtras(5 * 60, "Ronda de cinco minutos"), chat);
    else if (esc.modo === "eksamen") paso.insertBefore(cronometro("En la prueba real esta tarea dura de 2 a 3 minutos por candidato. Aquí nadie te corta: es solo orientación."), chat);

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
      if (!hayVozPara(turno.larsito_no)) apagarEscucha(bEsc, bLento, b);
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
      var modelo0 = (turno.respuestas_modelo_no || [])[0] || "";
      if (!hayVozPara(modelo0)) apagarEscucha(oir, null, caja);
      if (modelo0) bloqueRepite(caja, modelo0);

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
      if (!hayVozPara(ej.transcript_no)) apagarEscucha(reproducir, lento, caja);
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


  // ---------- Audio fijo de la demo ----------

  function construirAudioFijo(d) {
    audioEstatico = {};
    if (!d || d.audio_estatico !== true) return;
    (d.escenarios || []).forEach(function (esc) {
      (esc.turnos || []).forEach(function (t) {
        if (t.audio_no && t.larsito_no) audioEstatico[t.larsito_no] = t.audio_no;
        var m0 = (t.respuestas_modelo_no || [])[0];
        if (t.audio_modelo && m0) audioEstatico[m0] = t.audio_modelo;
      });
    });
    (d.listening || []).forEach(function (l) {
      if (l.audio && l.transcript_no) audioEstatico[l.transcript_no] = l.audio;
    });
  }

  function cargarIndiceCuaderno() {
    fetch(INDICE_CUADERNO, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { indiceCuaderno = j && j.piezas ? j.piezas : null; })
      .catch(function () { indiceCuaderno = null; });
  }

  function escenarioPorId(id) {
    if (!datos || !id) return null;
    var limpio = String(id).replace(/^DEMO:/, "");
    return (datos.escenarios || []).filter(function (e) { return e.id === limpio; })[0] || null;
  }

  // ---------- Repite tú: grabación local para compararte con el modelo ----------
  // La grabación vive solo en la memoria de esta pantalla. No se sube, no se guarda
  // y desaparece al cambiar de escena. Sin micrófono disponible, el bloque no aparece.

  function bloqueRepite(contenedor, textoModelo) {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof window.MediaRecorder !== "function") return;
    var caja = el("div", "repite");
    caja.appendChild(el("b", null, "Repite tú y compárate"));
    caja.appendChild(el("p", "ayuda", "Escucha el modelo, grábate diciendo lo mismo y oye las dos versiones seguidas. Tu grabación se queda en este navegador y desaparece al salir de la escena."));
    var fila = el("div", "fila-audio");
    var grabar = el("button", "mini", "Grabar mi intento");
    var oirMio = el("button", "mini", "Escuchar mi intento");
    var comparar = el("button", "mini", "Modelo y después yo");
    oirMio.hidden = true; comparar.hidden = true;
    var estadoR = el("p", "ayuda", "");
    var grabadora = null, trozos = [], urlMio = null, audioMio = null, tope = null;

    function liberar() {
      if (tope) { clearTimeout(tope); tope = null; }
      if (audioMio) { try { audioMio.pause(); } catch (err) {} audioMio = null; }
      if (grabadora && grabadora.state === "recording") { try { grabadora.stop(); } catch (err) {} }
      if (urlMio) { URL.revokeObjectURL(urlMio); urlMio = null; }
    }
    limpiezas.push(liberar);

    function reproducirMio() {
      if (!urlMio) return;
      pararAudio();
      audioMio = new Audio(urlMio);
      audioMio.play().catch(function () {});
    }

    grabar.addEventListener("click", function () {
      if (grabadora && grabadora.state === "recording") { grabadora.stop(); return; }
      pararAudio();
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        trozos = [];
        grabadora = new MediaRecorder(stream);
        grabadora.ondataavailable = function (e) { if (e.data && e.data.size) trozos.push(e.data); };
        grabadora.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          if (tope) { clearTimeout(tope); tope = null; }
          if (urlMio) URL.revokeObjectURL(urlMio);
          urlMio = URL.createObjectURL(new Blob(trozos, { type: grabadora.mimeType || "audio/webm" }));
          trozos = [];
          grabar.textContent = "Grabar otra vez";
          grabar.classList.remove("grabando");
          oirMio.hidden = false; comparar.hidden = false;
          estadoR.textContent = "Grabado. Solo está en tu navegador.";
        };
        grabadora.start();
        grabar.textContent = "Parar";
        grabar.classList.add("grabando");
        estadoR.textContent = "Grabando… (máximo 20 segundos)";
        tope = setTimeout(function () { if (grabadora && grabadora.state === "recording") grabadora.stop(); }, 20000);
      }).catch(function () {
        estadoR.textContent = "No se ha podido usar el micrófono. Puedes seguir escuchando el modelo.";
      });
    });
    oirMio.addEventListener("click", reproducirMio);
    comparar.addEventListener("click", function () {
      var r = hablar(textoModelo, false, function () { setTimeout(reproducirMio, 350); });
      if (!r) reproducirMio();
    });
    fila.appendChild(grabar); fila.appendChild(oirMio); fila.appendChild(comparar);
    caja.appendChild(fila);
    caja.appendChild(estadoR);
    contenedor.appendChild(caja);
  }

  // ---------- Cronómetro y cuenta atrás ----------
  // Solo orientan. Ni cortan la práctica ni entran en ninguna valoración.

  function formatoTiempo(seg) {
    var m = Math.floor(seg / 60), sg = seg % 60;
    return (m < 10 ? "0" : "") + m + ":" + (sg < 10 ? "0" : "") + sg;
  }

  function cronometro(nota) {
    var caja = el("div", "crono");
    var reloj = el("span", "reloj", "00:00");
    caja.appendChild(el("span", "eti", "Tiempo"));
    caja.appendChild(reloj);
    if (nota) caja.appendChild(el("p", "ayuda", nota));
    var inicio = Date.now();
    var id = setInterval(function () { reloj.textContent = formatoTiempo(Math.floor((Date.now() - inicio) / 1000)); }, 1000);
    caja.setAttribute("data-crono", String(id));
    limpiezas.push(function () { clearInterval(id); });
    return caja;
  }

  function cuentaAtras(segundos, titulo) {
    var caja = el("div", "crono corta");
    var reloj = el("span", "reloj", formatoTiempo(segundos));
    caja.appendChild(el("span", "eti", titulo));
    caja.appendChild(reloj);
    caja.appendChild(el("p", "ayuda", "Cuando llegue a cero, termina la frase que estés diciendo y cierra. Una ronda corta cada día vale más que una larga de vez en cuando."));
    var fin = Date.now() + segundos * 1000;
    var id = setInterval(function () {
      var resta = Math.max(0, Math.round((fin - Date.now()) / 1000));
      reloj.textContent = formatoTiempo(resta);
      if (resta === 0) { clearInterval(id); caja.classList.add("fin"); reloj.textContent = "Se acabó el tiempo"; }
    }, 500);
    caja.setAttribute("data-crono", String(id));
    limpiezas.push(function () { clearInterval(id); });
    return caja;
  }

  function pararCronometro(caja) {
    if (!caja) return;
    var id = Number(caja.getAttribute("data-crono"));
    if (id) clearInterval(id);
    caja.classList.add("fin");
  }

  // ---------- Ronda de cinco minutos ----------
  // El hábito manda: una escena, sin pistas si ya la hiciste, con cuenta atrás.

  function elegirEscenarioRonda() {
    if (!datos) return null;
    var pendiente = null;
    try { pendiente = aprendizaje ? aprendizaje.primeraVencida(estado.recuperaciones, new Date().toISOString()) : null; } catch (err) { pendiente = null; }
    if (pendiente) { var e = escenarioPorId(pendiente.source_id); if (e) return e; }
    var noHechos = (datos.escenarios || []).filter(function (e) { return !estado.hechos[e.id]; });
    if (noHechos.length) return noHechos[0];
    var todos = datos.escenarios || [];
    return todos[Math.floor(Math.random() * todos.length)] || null;
  }

  function renderRondaCorta(paso) {
    var esc = elegirEscenarioRonda();
    if (!esc) return;
    var caja = el("div", "aviso ronda");
    caja.appendChild(el("span", "eti", "Hoy, cinco minutos"));
    caja.appendChild(el("p", null, "Una escena y se acabó: " + esc.titulo + (estado.hechos[esc.id] ? ", esta vez sin bloques ni pistas." : ".")));
    var b = el("button", "btn", "Empezar la ronda");
    b.addEventListener("click", function () {
      if (agenteCargando) return;
      renderConversacion(esc, !!estado.hechos[esc.id], true);
    });
    caja.appendChild(b);
    paso.appendChild(caja);
  }

  // ---------- Tu recorrido: lo último que trabajaste ----------

  function renderRecorrido(paso) {
    var informes = (estado.informes || []).slice(0, 5);
    if (!informes.length) return;
    var caja = el("div", "cierre-panel recorrido");
    caja.appendChild(el("h2", null, "Lo último que trabajaste con Larsito"));
    var lista = el("ul", "lista-informes");
    informes.forEach(function (inf) {
      var li = el("li");
      var fecha = inf.fecha ? new Date(inf.fecha) : null;
      var cab = (fecha && !isNaN(fecha) ? fecha.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " · " : "") + (inf.mecanismo ? inf.mecanismo + " · " : "") + nombreModo(inf.modo);
      li.appendChild(el("b", null, cab));
      li.appendChild(el("p", null, inf.ahora || ""));
      var enlaces = enlacesDeMecanismo(inf.mecanismo);
      if (enlaces) li.appendChild(enlaces);
      lista.appendChild(li);
    });
    caja.appendChild(lista);
    paso.appendChild(caja);
  }

  function nombreModo(m) {
    return { FREE_CONVERSATION: "conversación libre", EXAM_SIMULATION: "simulacro", REAL_LIFE: "situación real", DEEP_CORRECTION: "corrección a fondo" }[m] || "sesión";
  }

  function enlacesDeMecanismo(codigo) {
    if (!codigo || !/^M(0[1-9]|1[0-6])$/.test(codigo)) return null;
    var p = el("p", "enlaces-informe");
    var curso = el("a", null, "Repasar " + codigo + " en el curso");
    curso.href = "/norsk/curso/#" + codigo;
    p.appendChild(curso);
    var ficha = indiceCuaderno && indiceCuaderno[codigo];
    if (ficha) {
      p.appendChild(document.createTextNode(" · "));
      p.appendChild(el("span", null, "Cuaderno: tomo " + ficha.tomo + ", página " + ficha.pagina));
    }
    return p;
  }

  // ---------- Calendario de repasos (.ics local) ----------

  function descargarCalendario() {
    var pendientes = (estado.recuperaciones || []).filter(function (x) { return x.estado === "PENDING"; });
    if (!pendientes.length) return;
    function icsFecha(iso) { return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
    function esc(t) { return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
    var lineas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NEXO NORSK//Larsito//ES", "CALSCALE:GREGORIAN"];
    pendientes.forEach(function (x) {
      var escena = escenarioPorId(x.source_id);
      var titulo = "Larsito · repaso " + x.contacto + (escena ? ": " + escena.titulo : "");
      lineas.push("BEGIN:VEVENT",
        "UID:" + esc(x.recovery_id) + "@nexonoruega.com",
        "DTSTAMP:" + icsFecha(new Date().toISOString()),
        "DTSTART:" + icsFecha(x.programada_en),
        "DURATION:PT10M",
        "SUMMARY:" + esc(titulo),
        "DESCRIPTION:" + esc("Cinco minutos con Larsito. Abre https://www.nexonoruega.com/norsk/larsito/ y haz la ronda del día."),
        "URL:https://www.nexonoruega.com/norsk/larsito/",
        "END:VEVENT");
    });
    lineas.push("END:VCALENDAR");
    var blob = new Blob([lineas.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "larsito-repasos.ics";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  // ---------- Memoria de Larsito (solo con el curso abierto) ----------
  // Al servidor viajan códigos y el foco de feedback, nunca audio ni transcripciones.

  function sincronizarRecuperaciones() {
    if (!LARSITO_ABIERTO) return;
    var cola = (estado.recuperaciones || []).slice(0, 40).map(function (x) {
      return {
        recovery_id: x.recovery_id, focus_id: x.focus_id, source_id: x.source_id, contacto: x.contacto,
        operacion_id: x.operacion_id, programada_en: x.programada_en, estado: x.estado, completada_en: x.completada_en || null,
      };
    });
    if (!cola.length) return;
    fetch(APRENDIZAJE, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "recuperaciones", cola: cola }),
    }).catch(function () { /* la cola local sigue siendo la fuente si el servidor no responde */ });
  }

  function recortar(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; }

  async function perfilParaAgente() {
    var informes = (estado.informes || []).slice();
    var recuperaciones = (estado.recuperaciones || []).slice();
    if (LARSITO_ABIERTO) {
      try {
        var r = await fetch(APRENDIZAJE + "?accion=perfil", { credentials: "same-origin" });
        var j = r.ok ? await r.json() : null;
        if (j && j.ok) {
          (j.informes || []).forEach(function (x) {
            informes.push({ fecha: x.created_at, modo: x.modo, mecanismo: x.mecanismo, ahora: x.ahora, escenario: x.escenario });
          });
          (j.recuperaciones || []).forEach(function (x) {
            if (!recuperaciones.some(function (y) { return y.recovery_id === x.recovery_id; })) recuperaciones.push(x);
          });
        }
      } catch (err) { /* sin servidor, memoria local */ }
    }
    var vistos = {};
    var focos = informes
      .sort(function (a, b) { return Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0); })
      .filter(function (x) { var k = (x.mecanismo || "") + "|" + (x.ahora || ""); if (vistos[k]) return false; vistos[k] = true; return true; })
      .slice(0, 3)
      .map(function (x) { return (x.mecanismo ? x.mecanismo + ": " : "") + recortar(x.ahora, 140); });
    var ahora = Date.now();
    var pendientes = recuperaciones
      .filter(function (x) { return x.estado === "PENDING" && Date.parse(x.programada_en) <= ahora; })
      .slice(0, 3)
      .map(function (x) { return "contacto " + x.contacto + " de " + x.focus_id; });
    var hechos = Object.keys(estado.hechos || {}).slice(0, 12).join(", ");
    return {
      ultimos_focos: focos.length ? focos.join(" | ") : "ninguno todavía",
      contactos_pendientes: pendientes.length ? pendientes.join(" | ") : "ninguno",
      escenarios_hechos: hechos || "ninguno",
      sesiones_previas: String(informes.length),
    };
  }

  function normalizarInforme(p, dinamicas, sesion) {
    if (!p || typeof p !== "object") return null;
    function t(v, obligatorio) {
      if (v === undefined || v === null || v === "") return obligatorio ? undefined : null;
      if (typeof v !== "string") return undefined;
      var limpio = v.replace(/\s+/g, " ").trim();
      return limpio.length && limpio.length <= 300 ? limpio : undefined;
    }
    function c(v, re) { if (v === undefined || v === null || v === "") return null; return typeof v === "string" && re.test(v) ? v : undefined; }
    var inf = {
      session_id: sesion || ("sesion-" + Date.now()),
      modo: dinamicas && dinamicas.modo ? dinamicas.modo : "FREE_CONVERSATION",
      escenario: c(p.escenario || (dinamicas && dinamicas.stimulus_a) || null, /^[A-Za-z0-9:_-]{1,48}$/),
      mecanismo: c(p.mecanismo, /^[A-Z0-9_-]{1,32}$/),
      pieza: c(p.pieza, /^[A-Za-z0-9:_-]{1,48}$/),
      puerta: c(p.puerta, /^O[1-7]$/),
      conserva: t(p.conserva, true),
      ahora: t(p.ahora, true),
      contraste: t(p.contraste, false),
      repite: t(p.repite, false),
      resultado: c(p.resultado, /^[A-Z_]{2,32}$/),
      fecha: new Date().toISOString(),
    };
    for (var k in inf) { if (inf[k] === undefined) return null; }
    return inf;
  }

  function mostrarInforme(contenedor, inf) {
    contenedor.innerHTML = "";
    contenedor.hidden = false;
    contenedor.appendChild(el("h3", null, "Informe de la sesión"));
    contenedor.appendChild(el("p", "ayuda", "Un solo foco, en español, después de la actuación. Lo verás la próxima vez que abras a Larsito."));
    [["Conserva", inf.conserva], ["Ahora", inf.ahora], ["Contraste", inf.contraste], ["Repite", inf.repite]].forEach(function (par) {
      if (!par[1]) return;
      var fila = el("div", "fila-informe");
      fila.appendChild(el("b", null, par[0]));
      var p = el("p", null, par[1]);
      if (par[0] === "Contraste") p.lang = "nb";
      fila.appendChild(p);
      contenedor.appendChild(fila);
    });
    var enlaces = enlacesDeMecanismo(inf.mecanismo);
    if (enlaces) contenedor.appendChild(enlaces);
    contenedor.scrollIntoView({ block: "nearest" });
  }

  function guardarInformeLocal(inf) {
    estado.informes = [{ fecha: inf.fecha, modo: inf.modo, escenario: inf.escenario, mecanismo: inf.mecanismo, ahora: inf.ahora }]
      .concat(estado.informes || []).slice(0, MAX_INFORMES_LOCALES);
    guardar();
  }

  function enviarInforme(inf) {
    if (!LARSITO_ABIERTO) return;
    var cuerpo = Object.assign({ accion: "informe" }, inf);
    delete cuerpo.fecha;
    fetch(APRENDIZAJE, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    }).catch(function () { /* el informe ya está en pantalla y en el progreso local */ });
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
        construirAudioFijo(datos);
        cargarIndiceCuaderno();
        renderInicio();
      })
      .catch(function () {
        error("La práctica no está disponible ahora mismo. Vuelve a intentarlo en un rato.");
      });
  }

  arrancar();
})();

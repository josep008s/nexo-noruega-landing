// App de los cursos de NEXO NORSK: la Ruta Norskprøven B1 y «Noruego desde cero
// hasta A2». Una sola app, una ruta activa (?ruta=…), un progreso por ruta en
// este navegador.
//
// Dos modos:
//   - Demo pública: muestra las piezas abiertas y el mapa del curso.
//   - Con acceso: pide el índice y cada pieza al servidor protegido.
//
// El progreso se guarda solo en este navegador.
(function () {
  "use strict";

  // Las dos rutas comparten app, endpoint y tabla. La B1 sigue siendo la ruta por
  // defecto: sin ?ruta= la app se comporta como hasta ahora.
  var RUTAS = {
    "norskproven-b1": { clave: "nexo_curso_v1", demo: "/data/norsk-curso-demo.json", cuaderno: "/data/norsk-cuaderno.json", muestra: "/norsk/curso/muestra/NEXO-NORSK_Cuaderno-B1_Muestra.pdf", kicker: "Curso B1", nombre: "Noruego de A2 a B1", landing: "/norsk/", titulo: "Curso B1 · NEXO NORSK", inventario: "21 actuaciones orales · 16 mecanismos B1 · 4 destrezas conectadas · más de 2.300 ejercicios opcionales" },
    "norsk-desde-cero-a2": { clave: "nexo_curso_cero_v1", demo: "/data/norsk-desde-cero-demo.json", cuaderno: null, muestra: null, kicker: "Noruego desde cero hasta A2", nombre: "Noruego desde cero hasta A2", landing: "/norsk/desde-cero/", titulo: "Noruego desde cero hasta A2 · NEXO NORSK", inventario: "4 zonas · 49 lecciones de 15 a 20 minutos · puente hacia el curso A2→B1 · Larsito desde la primera lección" },
  };
  var RUTA = (function () {
    var m = /[?&]ruta=([a-z0-9-]+)/.exec(window.location.search || "");
    return m && RUTAS[m[1]] ? m[1] : "norskproven-b1";
  })();
  var CFG = RUTAS[RUTA];
  var ES_CERO = RUTA === "norsk-desde-cero-a2";
  var DEMO = CFG.demo;
  var API_Q = "/api/norsk-curso/?ruta=" + encodeURIComponent(RUTA) + "&";
  var PRACTICA_META = "/data/norsk-practica-meta.json";
  var practicaMeta = null;
  var CLAVE = CFG.clave;
  var QUERY_RUTA = "?ruta=" + encodeURIComponent(RUTA);
  document.title = CFG.titulo;

  var app = document.getElementById("app");
  var chip = document.getElementById("estado");
  var readingProgress = document.getElementById("readingProgress");

  var indice = [];
  var cache = {};
  var conAcceso = false;
  var demo = null;
  var estado = cargarEstado();

  // ---------- Estado local ----------

  function cargarEstado() {
    try {
      var e = JSON.parse(localStorage.getItem(CLAVE) || "{}");
      if (!e.hechas) e.hechas = {};
      if (!e.actuaciones) e.actuaciones = {};
      if (!e.ultimaSeccion) e.ultimaSeccion = {};
      if (!e.ultimaPieza) e.ultimaPieza = null;
      if (!e.practica) e.practica = {};
      if (!e.repaso) e.repaso = { items: {} };
      return e;
    } catch (err) {
      return { hechas: {}, actuaciones: {}, ultimaSeccion: {}, ultimaPieza: null, practica: {}, repaso: { items: {} } };
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

  function enfocarTitulo() {
    var h1 = app.querySelector("h1");
    if (!h1) return;
    h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
  }

  function volver(texto, fn) {
    var b = el("button", "back", "← " + texto);
    b.addEventListener("click", fn);
    return b;
  }

  function dosCifras(n) { return String(n).padStart(2, "0"); }

  function piezaEnIndice(codigo) {
    return indice.filter(function (p) { return p.codigo === codigo; })[0] || null;
  }

  var ETIQUETAS_CODIGO = {
    DIAGNOSTICO_B1: "",
    "ANEXO-UTTRYKK": "Uttrykk",
    BANCO_CONSIGNAS_ORAL: "Oral 01",
    KIT_ORAL_21_JORNADAS: "Oral 02",
    LYTT_CORTOS_A: "Escucha 01",
    LYTT_CORTOS_B: "Escucha 02",
    LYTT_LARGOS: "Escucha 03",
    LES_BREVES: "Lectura 01",
    LES_LARGOS: "Lectura 02",
    SKRIV_B1: "Escritura",
    SIMULACROS_LYTT_LES_SKRIV: "Simulacro 01",
    SIMULACROS_ORAL: "Simulacro 02",
  };

  // Títulos tal y como los ve el alumno. Los archivos de producción llevan
  // coletillas del tipo "· Ruta Norskprøven B1 · NEXO NORSK, línea Idioma" que
  // aquí sobran, y algunos nombres se acortan para que el índice se lea de un
  // vistazo. El contenido no cambia; solo el rótulo.
  var TITULOS_ALUMNO = {
    DIAGNOSTICO_B1: "Tu punto de partida",
    M01: "El verbo en segunda posición",
    M02: "El orden de la subordinada",
    M03: "Describe con som",
    M04: "Pasado simple o perfecto",
    M05: "Cuenta lo que pasó en orden",
    M06: "Explica causas y consecuencias",
    M07: "Habla de condiciones e hipótesis",
    M08: "Usa la pasiva",
    M09: "Cuenta lo que dijo otra persona",
    M10: "Suena menos tajante",
    M11: "Acuerda, discrepa y retoma ideas",
    M12: "Habla de cantidades y ausencias",
    M13: "Aclara de quién es y a quién afecta",
    M14: "Entiende cartas y lenguaje oficial",
    M15: "Conecta un texto de principio a fin",
    M16: "Habla seguido y repara sobre la marcha",
    "ANEXO-UTTRYKK": "Expresiones por mecanismo",
    LYTT_CORTOS_A: "Guiones cortos de escucha, bloque A",
    LYTT_CORTOS_B: "Guiones cortos de escucha, bloque B",
    LYTT_LARGOS: "Guiones largos de escucha",
    LES_BREVES: "Textos breves de lectura",
    LES_LARGOS: "Textos largos de lectura",
    SKRIV_B1: "Expresión escrita: tareas, modelos y criterios",
    BANCO_CONSIGNAS_ORAL: "Banco de consignas del oral",
    KIT_ORAL_21_JORNADAS: "Kit oral: 21 actuaciones a tu ritmo",
    SIMULACROS_LYTT_LES_SKRIV: "Simulacros de escucha, lectura y escritura",
    SIMULACROS_ORAL: "Simulacros del oral",
  };
  var COLETILLAS_TITULO = /\s*·\s*Ruta Norskpr[øo]ven [A-Z0-9-]+(?:\s*·\s*NEXO NORSK(?:, l[ií]nea Idioma)?)?\s*$/i;

  function tituloAlumno(pieza) {
    if (!pieza) return "";
    if (TITULOS_ALUMNO[pieza.codigo]) return TITULOS_ALUMNO[pieza.codigo];
    return String(pieza.titulo || "").replace(COLETILLAS_TITULO, "").trim();
  }

  function conTituloAlumno(pieza) {
    return Object.assign({}, pieza, { titulo: tituloAlumno(pieza) });
  }

  function etiquetaCodigo(pieza) {
    if (Object.prototype.hasOwnProperty.call(ETIQUETAS_CODIGO, pieza.codigo)) return ETIQUETAS_CODIGO[pieza.codigo];
    var l = /^(?:PREA1|A1|A2)-U(\d\d)-L(\d\d)$/.exec(pieza.codigo);
    if (l) return "U" + l[1] + " · L" + l[2];
    if (/^PUENTE-/.test(pieza.codigo)) return "Puente";
    if (/^SALTO-/.test(pieza.codigo)) return "Salto";
    return pieza.codigo.replace(/_v.*/, "").slice(0, 12);
  }

  // Zona de una pieza del recorrido desde cero, deducida del código: el índice
  // protegido solo trae código, tipo, título y orden.
  function zonaDe(pieza) {
    if (pieza.zona) return pieza.zona;
    if (pieza.meta && pieza.meta.zona) return pieza.meta.zona;
    var c = String(pieza.codigo || "");
    if (/^PREA1-/.test(c) || c === "SALTO-PREA1-A1") return "PREA1";
    if (/^A1-/.test(c) || c === "SALTO-A1-A2") return "A1";
    if (/^A2-/.test(c)) return "A2";
    if (/^PUENTE-/.test(c)) return "PUENTE";
    return "";
  }
  var ZONAS = {
    PREA1: { titulo: "Primer contacto", nota: "Sonidos, letras, presentarte, deletrear, números, horas y pedir repetición. Reconocer antes que producir." },
    A1: { titulo: "A1", nota: "Presentarte, tu día, tu casa, comprar, moverte, pedir ayuda, el primer día de trabajo y quedar." },
    A2: { titulo: "A2", nota: "Contar lo que pasó y lo que viene, vivienda, trabajo, consulta, escuela, servicios y entrar en la conversación." },
    PUENTE: { titulo: "Puente hacia el curso A2→B1", nota: "Doce a quince minutos para saber si puedes abrir M01 y qué conviene repasar antes." },
  };
  var ORDEN_ZONAS = ["PREA1", "A1", "A2", "PUENTE"];

  var TIPOS = {
    diagnostico: { titulo: "Diagnóstico", nota: "Localiza qué destreza necesita trabajo antes de abrir más material." },
    muntlig: { titulo: "Hablar", nota: "El entrenamiento oral: consignas y 21 actuaciones para sostener el turno, reparar y volver a intentarlo." },
    mecanismo: { titulo: "Mecanismos B1", nota: "El salto de A2 a B1, explicado desde situaciones que sí ocurren." },
    lytt: { titulo: "Escuchar", nota: "Escucha, decide y comprueba qué información cambia la respuesta." },
    les: { titulo: "Leer", nota: "Textos breves y largos para leer condiciones, intención y detalle." },
    skriv: { titulo: "Escribir", nota: "Tareas, modelos y criterios para escribir con dirección." },
    anexo: { titulo: "Banco de expresiones", nota: "Expresiones de UTTRYKK colocadas donde activan cada mecanismo." },
    simulacro: { titulo: "Simulacros", nota: "La prueba completa cuando ya toca medir el recorrido entero." },
    larsito: { titulo: "Practicar con Larsito", nota: "El compañero de conversación del entrenamiento oral: conversación, segundo intento e informe." },
    leccion: { titulo: "Lección", nota: "Una sesión de 15 a 20 minutos: responde, repara, repite y cierra." },
    puente: { titulo: "Puente", nota: "Comprueba si puedes abrir el curso A2→B1." },
    salto: { titulo: "Salto", nota: "Entra en la zona siguiente sin recorrer la anterior." },
  };

  var ORDEN_TIPOS = ["diagnostico", "muntlig", "mecanismo", "lytt", "les", "skriv", "anexo", "simulacro"];

  var NOMBRES_DESTREZA = {
    MUNTLIG: "expresión oral",
    SKRIFTLIG: "expresión escrita",
    LES: "lectura",
    LYTT: "escucha",
  };

  function normalizarDestrezas(meta) {
    var bruto = meta && meta.delprover;
    if (!bruto) return [];
    var valores = [];
    function anadir(valor) {
      if (Array.isArray(valor)) return valor.forEach(anadir);
      if (valor !== null && valor !== undefined && valor !== "") valores.push(valor);
    }
    if (Array.isArray(bruto)) anadir(bruto);
    else if (typeof bruto === "string") anadir(bruto);
    else if (typeof bruto === "object") {
      anadir(bruto.principal);
      anadir(bruto.transferencia);
    }
    return valores
      .map(function (x) { return NOMBRES_DESTREZA[String(x).toUpperCase()] || String(x).toLowerCase(); })
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }

  function modoLector(activo) {
    document.body.classList.toggle("modo-lector", !!activo);
    if (!activo && readingProgress) readingProgress.style.width = "0";
    if (activo) requestAnimationFrame(actualizarProgresoLectura);
  }

  function actualizarProgresoLectura() {
    if (!readingProgress || !document.body.classList.contains("modo-lector")) return;
    var lector = document.querySelector(".lector");
    if (!lector) { readingProgress.style.width = "0"; return; }
    var inicio = lector.getBoundingClientRect().top + window.scrollY - 120;
    var total = Math.max(1, lector.offsetHeight - window.innerHeight * .55);
    var avance = Math.max(0, Math.min(1, (window.scrollY - inicio) / total));
    readingProgress.style.width = Math.round(avance * 100) + "%";
  }

  window.addEventListener("scroll", actualizarProgresoLectura, { passive: true });
  window.addEventListener("resize", actualizarProgresoLectura);

  // ---------- Repaso entre piezas ----------

  function fechaCorta(iso) {
    try { return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long" }); } catch (err) { return ""; }
  }

  function renderTarjetaRepaso() {
    var pendiente = window.NexoPractica.repasoPendiente(estado);
    if (!pendiente.total) return null;
    var caja = el("section", "repaso-tarjeta" + (pendiente.vencidos.length ? " vence" : ""));
    caja.appendChild(el("span", "eti", pendiente.vencidos.length ? "Ahora" : "Repaso"));
    var txt = el("div", "txt");
    if (pendiente.vencidos.length) {
      txt.appendChild(el("strong", null, pendiente.vencidos.length + (pendiente.vencidos.length === 1 ? " ejercicio para hoy" : " ejercicios para hoy")));
      txt.appendChild(el("small", null, "Lo que fallaste en " + (pendiente.piezas.length === 1 ? "la pieza " : "las piezas ") + pendiente.piezas.join(", ") + ". Cinco minutos y se asienta."));
    } else {
      txt.appendChild(el("strong", null, "Nada vence hoy"));
      txt.appendChild(el("small", null, pendiente.total + (pendiente.total === 1 ? " ejercicio programado" : " ejercicios programados") + ". El próximo repaso, el " + fechaCorta(pendiente.proximo) + "."));
    }
    caja.appendChild(txt);
    var b = el("button", "btn" + (pendiente.vencidos.length ? "" : " ghost"), pendiente.vencidos.length ? "Repasar ahora" : "Adelantar el repaso");
    b.addEventListener("click", function () { renderRepaso(!pendiente.vencidos.length); });
    caja.appendChild(b);
    return caja;
  }

  function renderRepaso(adelantar) {
    modoLector(false);
    limpiar();
    var paso = el("div", "step step-repaso");
    paso.appendChild(volver("Volver al curso", renderIndice));
    var cargando = el("p", "intro", "Preparando el repaso…");
    paso.appendChild(cargando);
    app.appendChild(paso);

    var pendiente = window.NexoPractica.repasoPendiente(estado);
    var lista = pendiente.vencidos.length ? pendiente.vencidos : (adelantar ? pendiente.futuros : []);
    // Solo piezas abiertas para esta persona; las demás se quedan programadas.
    lista = lista.filter(function (x) { var p = piezaEnIndice(x.pieza); return p && p.abierta; }).slice(0, window.NexoPractica.TANDA);
    if (!lista.length) { cargando.textContent = "No hay nada que repasar ahora mismo."; return; }

    var codigos = [];
    lista.forEach(function (x) { if (codigos.indexOf(x.pieza) < 0) codigos.push(x.pieza); });
    var cargas = codigos.map(function (c) { return cargarPieza(c); });
    cargas.push(conAcceso ? cargarPieza("ANEXO-UTTRYKK") : Promise.resolve(null));
    Promise.all(cargas).then(function (piezas) {
      var anexo = piezas.pop();
      var porCodigo = {};
      piezas.forEach(function (p, i) { if (p) porCodigo[codigos[i]] = p; });
      var entradas = [];
      lista.forEach(function (x) {
        var pieza = porCodigo[x.pieza];
        if (!pieza) return;
        var b = window.NexoPractica.banco(pieza, window.NexoPractica.seccionAnexo(anexo, pieza.codigo));
        var item = b.items.filter(function (it) { return it.id === x.id; })[0];
        if (item) entradas.push({ pieza: x.pieza, item: item });
        else { delete estado.repaso.items[x.pieza + "|" + x.id]; guardar(); }
      });
      cargando.remove();
      if (!entradas.length) { paso.appendChild(el("p", "intro", "Estos ejercicios ya no están en el banco de su pieza. Se han quitado del repaso.")); return; }
      paso.appendChild(window.NexoPractica.montarRepaso(entradas, {
        estado: estado,
        guardar: guardar,
        alVolver: renderIndice,
        alSeguir: function () { renderRepaso(false); },
      }));
      window.scrollTo({ top: 0, behavior: "auto" });
    }).catch(function () {
      cargando.textContent = "No se ha podido preparar el repaso. Vuelve a intentarlo en un momento.";
    });
  }

  // ---------- Pantalla: índice del curso ----------

  function renderDato(numero, texto) {
    var d = el("div", "curso-dato");
    d.appendChild(el("strong", null, numero));
    d.appendChild(el("span", null, texto));
    return d;
  }

  function renderLarsito() {
    var franja = el("aside", "larsito-franja");
    var copia = el("div");
    copia.appendChild(el("p", "eti", "Dentro del núcleo oral"));
    copia.appendChild(el("h3", null, "Habla, repara y vuelve a intentarlo."));
    copia.appendChild(el("p", null, "Larsito convierte cada actuación en conversación y feedback, sin guardar el contenido de tu respuesta."));
    franja.appendChild(copia);
    var a = el("a", null, "Practicar con Larsito →");
    a.href = "/norsk/larsito/" + (ES_CERO ? QUERY_RUTA : "");
    franja.appendChild(a);
    return franja;
  }

  // ---------- Cuaderno en PDF (seis tomos) ----------
  // Los metadatos públicos (título, páginas, peso) vienen de /data/norsk-cuaderno.json.
  // Con acceso, cada tomo enlaza a /api/norsk-cuaderno/?tomo=N, que comprueba la
  // compra y redirige a una URL firmada de quince minutos. En la demo no se llama
  // a nada: se enseña lo que hay y se ofrece la muestra gratuita.
  var CUADERNO_META = CFG.cuaderno;
  var CUADERNO_API = "/api/norsk-cuaderno/" + QUERY_RUTA + "&";
  var CUADERNO_MUESTRA = CFG.muestra;

  function renderCuaderno() {
    var sec = el("section", "cuaderno");
    var cab = el("div", "cuaderno-cab");
    cab.appendChild(el("p", "eti", "Material de apoyo"));
    cab.appendChild(el("h2", null, "Tu cuaderno en PDF"));
    cab.appendChild(el("p", "cuaderno-intro", conAcceso
      ? "El curso entero en seis tomos para imprimir o leer sin conexión: la teoría con sus esquemas, la práctica con renglones y las claves aparte. Cada descarga es personal y caduca a los quince minutos; vuelve a pulsar si se te pasa."
      : "El curso entero en seis tomos para imprimir o leer sin conexión: la teoría con sus esquemas, la práctica con renglones y las claves aparte. Viene con el curso completo. Hoy puedes bajarte la muestra gratuita: la guía de uso y el primer mecanismo entero."));
    sec.appendChild(cab);
    var lista = el("div", "cuaderno-lista");
    sec.appendChild(lista);
    if (!conAcceso && CUADERNO_MUESTRA) {
      var m = el("a", "btn cuaderno-muestra", "Descargar la muestra gratis (PDF)");
      m.href = CUADERNO_MUESTRA; m.setAttribute("download", "");
      sec.appendChild(m);
    }
    if (!CUADERNO_META) {
      lista.appendChild(el("p", "cuaderno-intro", "El cuaderno en PDF de este recorrido está en preparación. Cuando exista, aparecerá aquí tomo a tomo."));
      return sec;
    }
    fetch(CUADERNO_META, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.tomos)) return;
        d.tomos.forEach(function (t) {
          var fila = el(conAcceso ? "a" : "div", "cuaderno-tomo");
          fila.appendChild(el("span", "cuaderno-num", String(t.n)));
          var txt = el("span", "cuaderno-txt");
          txt.appendChild(el("strong", null, t.titulo));
          txt.appendChild(el("small", null, t.que + " · " + t.paginas + " páginas"));
          fila.appendChild(txt);
          if (conAcceso) {
            fila.href = CUADERNO_API + "tomo=" + t.n;
            fila.setAttribute("rel", "nofollow");
            fila.appendChild(el("span", "cuaderno-accion", "Descargar"));
          } else {
            fila.appendChild(el("span", "marca-est bloq", "Con el curso"));
          }
          lista.appendChild(fila);
        });
      })
      .catch(function () {
        if (ES_CERO) lista.appendChild(el("p", "cuaderno-intro", "El cuaderno en PDF de este recorrido está en preparación. Cuando exista, aparecerá aquí tomo a tomo."));
      });
    return sec;
  }

  var ORDEN_GUIADO = [
    "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08",
    "M09", "M10", "M11", "M12", "M13", "M14", "M15", "M16",
    "KIT_ORAL_21_JORNADAS", "SIMULACROS_ORAL",
  ];

  function siguienteGuiada() {
    var ultima = estado.ultimaPieza ? piezaEnIndice(estado.ultimaPieza) : null;
    if (ultima && ultima.abierta && !estado.hechas[ultima.codigo]) return ultima;
    for (var i = 0; i < ORDEN_GUIADO.length; i++) {
      var candidata = piezaEnIndice(ORDEN_GUIADO[i]);
      if (candidata && candidata.abierta && !estado.hechas[candidata.codigo]) return candidata;
    }
    return indice.filter(function (p) { return p.abierta && p.tipo !== "diagnostico" && !estado.hechas[p.codigo]; })[0] || null;
  }

  function motivoSiguiente(pieza) {
    if (!pieza) return "Has completado lo que tienes abierto. Puedes reforzar un mecanismo o entrar en la biblioteca.";
    if (estado.ultimaPieza === pieza.codigo) return "Retoma donde lo dejaste. Tu progreso y la última sección siguen en este navegador.";
    if (pieza.tipo === "leccion") return pieza.resumen || "Responde antes de leer, entiende una corrección y vuelve a usarla con datos nuevos.";
    if (pieza.tipo === "puente") return "Doce a quince minutos. Te dice, mecanismo a mecanismo, si puedes abrir M01 y qué repasar.";
    if (pieza.tipo === "salto") return "Ocho o doce pasos para entrar directamente en la zona siguiente.";
    if (pieza.tipo === "mecanismo") return "Lee solo lo necesario, haz una tanda interactiva y termina con una segunda respuesta.";
    if (pieza.codigo === "KIT_ORAL_21_JORNADAS") return "Ya tienes los mecanismos. Ahora toca sostener respuestas completas en situaciones diferentes.";
    if (pieza.codigo === "SIMULACROS_ORAL") return "Junta lo trabajado y comprueba cómo respondes con el formato y el tiempo de la prueba.";
    return "Continúa el recorrido desde esta destreza y cierra con práctica.";
  }

  function renderSiguientePaso(pieza) {
    var caja = el("section", "siguiente-paso");
    var copia = el("div");
    copia.appendChild(el("p", "eti", pieza ? "Tu siguiente paso" : "Recorrido al día"));
    copia.appendChild(el("h2", null, pieza ? pieza.titulo : "Has terminado todo lo que tienes abierto."));
    copia.appendChild(el("p", null, motivoSiguiente(pieza)));
    if (pieza) {
      var tipo = (TIPOS[pieza.tipo] || {}).titulo || "Curso B1";
      copia.appendChild(el("p", "detalle", tipo + (totalPracticaDe(pieza.codigo) ? " · " + formatoNumero(totalPracticaDe(pieza.codigo)) + " ejercicios opcionales" : "")));
    }
    caja.appendChild(copia);
    if (pieza) {
      var boton = el("button", "btn", estado.ultimaPieza === pieza.codigo ? "Continuar" : "Empezar");
      boton.addEventListener("click", function () { abrirPieza(pieza.codigo); });
      caja.appendChild(boton);
    }
    return caja;
  }

  function renderMapaSesion() {
    var sec = el("section", "sesion-mapa");
    sec.appendChild(el("h2", null, "Responde. Repara. Repite."));
    sec.appendChild(el("p", null, "La sesión termina cuando usas la corrección en una situación nueva. Lo que fallas vuelve a los 1, 3, 7 y 14 días."));
    var lista = el("ol", "sesion-pasos");
    ["Responde", "Repara", "Repite"].forEach(function (texto, i) {
      var item = el("li");
      item.appendChild(el("span", null, dosCifras(i + 1)));
      item.appendChild(document.createTextNode(texto));
      lista.appendChild(item);
    });
    sec.appendChild(lista);
    return sec;
  }

  function renderHerramientas(proxima) {
    var sec = el("section", "herramientas");
    sec.appendChild(el("h2", null, "Si te queda energía, esto es extra"));
    sec.appendChild(el("p", null, "La cantidad está detrás del recorrido, no encima de ti. Puedes seguir practicando o cambiar al oral sin perder el punto del curso."));
    var grid = el("div", "herramientas-grid");

    var practica = el("article", "herramienta");
    practica.appendChild(el("p", "eti", "Banco interactivo"));
    var tituloPractica = el("h3");
    var cantidad = el("span", null, ES_CERO ? formatoNumero(totalPracticaCero()) : (practicaMeta && practicaMeta.ejercicios_totales ? formatoNumero(practicaMeta.ejercicios_totales) : "Más de 2.300"));
    cantidad.setAttribute("data-practica-total", "");
    tituloPractica.appendChild(cantidad);
    tituloPractica.appendChild(document.createTextNode(" ejercicios opcionales"));
    practica.appendChild(tituloPractica);
    practica.appendChild(el("p", null, ES_CERO
      ? "Cada lección lleva su práctica extra opcional, hecha con sus propias frases: escuchar, ordenar, completar, emparejar, dictado y grabarte. Lo que falles vuelve a los 1, 3, 7 y 14 días."
      : "Arrastra, ordena, relaciona, completa, elige y escribe. Los fallos se pueden guardar para el repaso de 1, 3, 7 y 14 días."));
    var mecanismo = proxima && (proxima.tipo === "mecanismo" || proxima.tipo === "leccion") ? proxima : (indice.filter(function (p) {
      return (p.tipo === "mecanismo" || p.tipo === "leccion") && p.abierta && !estado.hechas[p.codigo];
    })[0] || piezaEnIndice("M01"));
    if (mecanismo && mecanismo.abierta) {
      var boton = el("button", "btn ghost", "Abrir una práctica");
      boton.addEventListener("click", function () { abrirPieza(mecanismo.codigo); });
      practica.appendChild(boton);
    }
    grid.appendChild(practica);

    var larsito = el("article", "herramienta");
    larsito.appendChild(el("p", "eti", "Práctica oral"));
    larsito.appendChild(el("h3", null, "Habla con Larsito"));
    larsito.appendChild(el("p", null, ES_CERO
      ? "Desde la primera lección: Larsito te hace las preguntas muy despacio, te da una pista en castellano si te quedas en blanco y solo reconoce las respuestas preparadas. No analiza tu pronunciación."
      : "Lleva el mecanismo a una conversación, recibe una prioridad y vuelve a responder. La demo incluye seis situaciones y seis ejercicios de escucha."));
    var enlace = el("a", "btn", "Abrir Larsito");
    enlace.href = "/norsk/larsito/" + (ES_CERO ? QUERY_RUTA : "");
    larsito.appendChild(enlace);
    grid.appendChild(larsito);

    sec.appendChild(grid);
    return sec;
  }

  function renderBiblioteca(recorrido) {
    var total = demo && demo.meta && demo.meta.piezas_totales ? demo.meta.piezas_totales : indice.length;
    var detalles = document.createElement("details");
    detalles.className = "biblioteca";
    var resumen = document.createElement("summary");
    var copia = el("div");
    copia.appendChild(el("p", "eti", "Biblioteca completa"));
    copia.appendChild(el("h2", null, ES_CERO ? "Explorar las " + total + " piezas del recorrido" : "Explorar " + total + " piezas y los seis tomos"));
    resumen.appendChild(copia);
    resumen.appendChild(el("span", "abrir", "Abrir"));
    detalles.appendChild(resumen);
    var interior = el("div", "biblioteca-interior");
    interior.appendChild(recorrido);
    interior.appendChild(renderCuaderno());
    detalles.appendChild(interior);
    return detalles;
  }

  function renderIndice() {
    modoLector(false);
    limpiar();

    var paso = el("div", "step step-indice");
    var hero = el("section", "curso-hero");
    hero.appendChild(el("p", "kicker caesar", CFG.kicker));

    var h1 = el("h1");
    h1.appendChild(document.createTextNode("Abre tu "));
    h1.appendChild(el("mark", "marcado", "siguiente paso"));
    h1.appendChild(document.createTextNode(". El resto puede esperar"));
    h1.appendChild(document.createTextNode("."));
    hero.appendChild(h1);

    hero.appendChild(el("p", "intro", conAcceso
      ? "Tu trabajo aquí no es recorrer un índice. Haz una sesión: responde, repara, repite y cierra."
      : (ES_CERO
        ? "Empieza por una lección abierta de la unidad piloto: escuchas, respondes, entiendes una corrección y vuelves a intentarlo. El resto del recorrido se abre con el curso."
        : "Empieza con el primer mecanismo completo. Si no sabes qué necesitas reforzar, el diagnóstico opcional está en la biblioteca.")));
    var otraRuta = ES_CERO ? "norskproven-b1" : "norsk-desde-cero-a2";
    var cambio = el("p", "cambio-ruta");
    cambio.appendChild(document.createTextNode("Estás en " + CFG.nombre + ". "));
    var aCambio = el("a", null, "Ir a " + RUTAS[otraRuta].nombre);
    aCambio.href = "/norsk/curso/?ruta=" + otraRuta;
    cambio.appendChild(aCambio);
    hero.appendChild(cambio);

    if (!conAcceso) {
      hero.appendChild(el("p", "nota-demo", "Muestra sin registro. El contenido bloqueado solo enseña su nombre; no expone el material de pago."));
    }
    hero.appendChild(el("p", "curso-inventario", CFG.inventario));
    paso.appendChild(hero);
    requestAnimationFrame(pintarDatoPractica);

    var proxima = siguienteGuiada();
    var pendiente = window.NexoPractica ? window.NexoPractica.repasoPendiente(estado) : null;
    if (pendiente && pendiente.vencidos.length) paso.appendChild(renderTarjetaRepaso());
    else paso.appendChild(renderSiguientePaso(proxima));
    paso.appendChild(renderMapaSesion());

    var abiertas = indice.filter(function (p) { return p.abierta && p.tipo !== "diagnostico"; });
    var hechas = abiertas.filter(function (p) { return estado.hechas[p.codigo]; }).length;
    if (abiertas.length) {
      var pr = el("div", "progreso");
      var cab = el("div", "progreso-cab");
      cab.appendChild(el("p", "lab", "Tu recorrido"));
      cab.appendChild(el("p", "valor", hechas + " de " + abiertas.length));
      pr.appendChild(cab);
      var barra = el("div", "barra");
      var relleno = el("i");
      relleno.style.width = Math.round((hechas / abiertas.length) * 100) + "%";
      barra.appendChild(relleno);
      pr.appendChild(barra);
      pr.appendChild(el("p", "nota", hechas === 0
        ? "Marca una pieza cuando la hayas trabajado. El progreso queda solo en este navegador."
        : (hechas === abiertas.length ? "Has pasado por todo lo que tienes abierto." : "Continúa desde la última pieza o cambia de destreza.")));
      pr.classList.add("progreso-compacto");
      paso.appendChild(pr);
    }
    paso.appendChild(renderHerramientas(proxima));

    var recorrido = el("div", "recorrido");
    var numeroBloque = 0;
    // La B1 se agrupa por tipo de material; el recorrido desde cero, por zona.
    var grupos = ES_CERO
      ? ORDEN_ZONAS.map(function (z) { return { clave: z, info: ZONAS[z], piezas: indice.filter(function (p) { return zonaDe(p) === z; }) }; })
      : ORDEN_TIPOS.map(function (t) { return { clave: t, info: TIPOS[t] || { titulo: t, nota: "" }, piezas: indice.filter(function (p) { return p.tipo === t; }) }; });
    grupos.forEach(function (grupo) {
      var tipo = grupo.clave;
      var piezas = grupo.piezas;
      if (!piezas.length) return;
      numeroBloque++;
      var info = grupo.info;

      var bloque = el("section", "bloque bloque-" + tipo);
      var cab = el("div", "bloque-cab");
      cab.appendChild(el("span", "bloque-num", dosCifras(numeroBloque)));
      var tit = el("div", "bloque-tit");
      tit.appendChild(el("h2", null, info.titulo));
      if (info.nota) tit.appendChild(el("p", null, info.nota));
      cab.appendChild(tit);
      cab.appendChild(el("span", "cuenta", piezas.length === 1 ? (ES_CERO ? "1 lección" : "1 pieza") : piezas.length + (ES_CERO ? " lecciones" : " piezas")));
      bloque.appendChild(cab);

      var lista = el("div", "lista");
      piezas.forEach(function (p) {
        var b = el("button", "item");
        var codigoVisible = etiquetaCodigo(p);
        if (codigoVisible) b.appendChild(el("span", "cod", codigoVisible));
        else b.classList.add("sin-codigo");
        var txt = el("span", "txt");
        txt.appendChild(document.createTextNode(p.titulo));
        if (p.resumen) txt.appendChild(el("small", null, p.resumen));
        b.appendChild(txt);

        if (!p.abierta) {
          b.appendChild(el("span", "marca-est bloq", "Curso completo"));
          b.disabled = true;
          b.title = "Esta pieza se abre con el curso completo";
        } else if (estado.hechas[p.codigo]) {
          b.appendChild(el("span", "marca-est hecho", "Hecha"));
        } else if (estado.practica && estado.practica[p.codigo] && (estado.practica[p.codigo].hechos || estado.practica[p.codigo].mejor)) {
          var reg = estado.practica[p.codigo];
          var totalP = totalPracticaDe(p.codigo);
          b.appendChild(el("span", "marca-est practica", "Práctica " + formatoNumero(reg.hechos || 0) + (totalP ? " de " + formatoNumero(totalP) : "")));
        } else {
          b.appendChild(el("span", "flecha", "→"));
        }

        if (p.abierta) b.addEventListener("click", function () { abrirPieza(p.codigo); });
        lista.appendChild(b);
      });
      bloque.appendChild(lista);
      if (tipo === "muntlig" || (ES_CERO && tipo === "PREA1")) bloque.appendChild(renderLarsito());
      recorrido.appendChild(bloque);
    });
    paso.appendChild(renderBiblioteca(recorrido));

    if (!conAcceso) {
      var cierre = el("section", "cierre-demo");
      cierre.appendChild(el("h2", null, "El curso completo todavía no está a la venta."));
      cierre.appendChild(el("p", null, "Cuando abra, se avisará por correo. Sin cuenta atrás y sin urgencia fabricada."));
      var aS = el("a", "btn", "Avísame cuando abra");
      aS.href = "https://nexonoruega.substack.com/subscribe?utm_source=nexonoruega.com&utm_medium=web&utm_campaign=" + (ES_CERO ? "norsk-desde-cero" : "norsk-curso");
      cierre.appendChild(aS);
      paso.appendChild(cierre);
    }

    app.appendChild(paso);
    window.scrollTo({ top: 0, behavior: "auto" });
    enfocarTitulo();
  }

  // ---------- Pantalla: lector de una pieza ----------

  function abrirPieza(codigo) {
    estado.ultimaPieza = codigo;
    guardar();
    if (cache[codigo]) return renderPieza(cache[codigo]);

    modoLector(false);
    limpiar();
    var cargando = el("div", "error");
    cargando.appendChild(el("p", "intro", "Abriendo…"));
    app.appendChild(cargando);

    if (!conAcceso) {
      var enDemo = (demo.piezas || []).filter(function (p) { return p.codigo === codigo; })[0];
      if (enDemo) { cache[codigo] = conTituloAlumno(enDemo); return renderPieza(cache[codigo]); }
      return error("Esta pieza pertenece al curso completo.");
    }

    fetch(API_Q + "modo=pieza&codigo=" + encodeURIComponent(codigo), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.pieza) throw new Error(d && d.error ? d.error : "pieza");
        cache[codigo] = conTituloAlumno(d.pieza);
        renderPieza(cache[codigo]);
      })
      .catch(function (e) {
        error(String(e.message) === "limite"
          ? "Has abierto muchas piezas hoy. Mañana vuelves a tener el cupo entero."
          : "No se ha podido abrir esta pieza. Vuelve a intentarlo en un momento.");
      });
  }

  // Devuelve una pieza con sus secciones sin pintarla: caché, JSON de demo o revisión, o API con acceso.
  function cargarPieza(codigo) {
    if (cache[codigo]) return Promise.resolve(cache[codigo]);
    var enDemo = ((demo && demo.piezas) || []).filter(function (p) { return p.codigo === codigo; })[0];
    if (enDemo) { cache[codigo] = conTituloAlumno(enDemo); return Promise.resolve(cache[codigo]); }
    if (!conAcceso) return Promise.resolve(null);
    return fetch(API_Q + "modo=pieza&codigo=" + encodeURIComponent(codigo), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.pieza) return null;
        cache[codigo] = conTituloAlumno(d.pieza);
        return cache[codigo];
      })
      .catch(function () { return null; });
  }

  function formatoNumero(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }

  function totalPracticaDe(codigo) {
    if (ES_CERO) {
      var p = cache[codigo];
      if (p && p.meta && Array.isArray(p.meta.ejercicios) && window.NexoPractica) { try { return window.NexoPractica.banco(p, null).opcionales.length; } catch (err) { return 0; } }
      return practicaMeta && practicaMeta.por_ruta && practicaMeta.por_ruta[RUTA] && practicaMeta.por_ruta[RUTA][codigo] ? practicaMeta.por_ruta[RUTA][codigo] : 0;
    }
    return practicaMeta && practicaMeta.por_pieza && practicaMeta.por_pieza[codigo] ? practicaMeta.por_pieza[codigo] : 0;
  }

  // Total de práctica extra de las piezas abiertas del recorrido desde cero (la demo no lleva metadatos por ruta).
  function totalPracticaCero() {
    if (practicaMeta && practicaMeta.por_ruta && practicaMeta.por_ruta[RUTA] && practicaMeta.por_ruta[RUTA].total) return practicaMeta.por_ruta[RUTA].total;
    var n = 0;
    Object.keys(cache).forEach(function (c) { n += totalPracticaDe(c); });
    return n;
  }

  function pintarDatoPractica() {
    document.querySelectorAll("[data-practica-total]").forEach(function (n) {
      if (ES_CERO) n.textContent = formatoNumero(totalPracticaCero());
      else if (practicaMeta && practicaMeta.ejercicios_totales) n.textContent = formatoNumero(practicaMeta.ejercicios_totales);
    });
    var datos = document.querySelector(".curso-datos");
    if (!datos || datos.querySelector(".dato-practica") || !practicaMeta || !practicaMeta.ejercicios_totales) return;
    var d = renderDato(formatoNumero(practicaMeta.ejercicios_totales), "ejercicios interactivos");
    d.classList.add("dato-practica");
    datos.appendChild(d);
  }

  function textoPlano(html) {
    var contenedor = document.createElement("div");
    contenedor.innerHTML = String(html || "");
    return (contenedor.textContent || "").replace(/\s+/g, " ").trim();
  }

  function esAvisoLegalAlumno(bloque) {
    var plano = textoPlano(bloque);
    return /NEXO NORSK/i.test(plano)
      && /(?:proyecto independiente|material propio)/i.test(plano)
      && /(?:HK-dir|UDI|centro de examen)/i.test(plano)
      && /(?:no es (?:la prueba|un examen)|no promete|no reproduce|no estamos vinculados|no tenemos relaci[oó]n)/i.test(plano);
  }

  function limpiarHtmlAlumno(html, seccionId, piezaCodigo) {
    var limpio = String(html || "");
    // "Sensor" es el término noruego para quien evalúa, pero en castellano
    // parece una máquina. La interfaz habla siempre de la persona evaluadora.
    limpio = limpio.replace(/\bsi el sensor\b/gi, "si el evaluador");
    limpio = limpio.replace(/<pre><code>\s*(?:MECANISMO|DOCUMENTO|PIEZA):[\s\S]*?<\/code><\/pre>/gi, "");
    if (seccionId === "intro" || seccionId === "nota-de-limites") {
      limpio = limpio.replace(/<blockquote>[\s\S]*?<\/blockquote>/gi, function (bloque) { return esAvisoLegalAlumno(bloque) ? "" : bloque; });
      limpio = limpio.replace(/<p>[\s\S]*?<\/p>/gi, function (bloque) { return esAvisoLegalAlumno(bloque) ? "" : bloque; });
      if (seccionId === "intro") limpio = limpio.replace(/<p>(?:Los seis pasos del (?:canon|método)|Cómo se corresponde esta lección con los seis pasos|Recorrido de la lección|Esta lección recorre|La lección sigue)[\s\S]*?<\/p>/gi, "");
    }
    // Ruido de producción que no aporta nada al alumno: la tabla que cruza los
    // "pasos del canon" con las secciones, los párrafos que hablan del canon y
    // sus códigos internos (B1-P01), y la columna "Pieza" de las tablas.
    limpio = limpio.replace(/<table>(?:(?!<\/table>)[\s\S])*?Paso del canon(?:(?!<\/table>)[\s\S])*?<\/table>/gi, "");
    limpio = limpio.replace(/<p>(?:(?!<\/p>)[\s\S])*?(?:del canon|piezas? del canon|estado P\b)(?:(?!<\/p>)[\s\S])*?<\/p>/gi, "");
    limpio = limpio.replace(/\s*·\s*B1-P\d{2}(?:\s*\([A-Z]\))?/g, "");
    limpio = limpio.replace(/<table>(?:(?!<\/table>)[\s\S])*?<\/table>/gi, function (tabla) { return quitarColumnaPieza(tabla); });
    if (seccionId === "intro") limpio = limpio.replace(/<hr\s*\/?>/gi, "");
    if (piezaCodigo === "DIAGNOSTICO_B1" && seccionId === "intro") {
      limpio = limpio.replace(/<blockquote>[\s\S]*?Uso vigente[\s\S]*?<\/blockquote>/gi,
        "<blockquote><p><strong>Antes de empezar.</strong> Este curso parte de un A2 funcional: entiendes instrucciones breves y puedes producir frases propias. El diagnóstico decide qué destreza trabajar primero.</p></blockquote>");
    }
    return limpio.replace(/^\s+|\s+$/g, "");
  }

  function quitarColumnaPieza(tabla) {
    var cab = tabla.match(/<thead>[\s\S]*?<\/thead>/i);
    if (!cab) return tabla;
    var ths = cab[0].match(/<th[^>]*>[\s\S]*?<\/th>/gi) || [];
    var idx = -1;
    ths.forEach(function (th, i) { if (/^<th[^>]*>\s*Pieza\s*<\/th>$/i.test(th)) idx = i; });
    if (idx < 0) return tabla;
    return tabla.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, function (fila) {
      var celdas = fila.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
      if (celdas.length <= idx) return fila;
      celdas.splice(idx, 1);
      return fila.replace(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi, function () { return ""; }).replace(/(<tr[^>]*>)/i, "$1" + celdas.join(""));
    });
  }

  function tituloSeccionAlumno(pieza, seccion) {
    var clave = pieza.codigo + ":" + seccion.id;
    var propios = {
      "DIAGNOSTICO_B1:intro": "Qué vas a comprobar",
      "DIAGNOSTICO_B1:como-hacer-este-perfil-opcional": "Cómo hacer el diagnóstico",
      "KIT_ORAL_21_JORNADAS:intro": "Cómo funciona el entrenamiento",
      "SIMULACROS_LYTT_LES_SKRIV:convenciones-de-este-documento": "Cómo usar estos simulacros",
    };
    if (propios[clave]) return propios[clave];
    if (seccion.id === "nota-de-limites") return "Antes de empezar";
    if (seccion.id === "limites-de-este-documento") return "Qué practica este material";
    if (seccion.id === "convenciones-de-este-documento") return "Cómo usar este material";
    // Cada archivo numeraba sus apartados a su manera ("1. La escena" en unos, "La escena" en otros).
    // Se quita la numeración de un nivel; la de dos niveles (1.1, 2.3) se conserva porque distingue simulacros.
    return String(seccion.titulo || "").replace(/^\d+\.\s+(?=\D)/, "");
  }

  function prepararSecciones(pieza) {
    return (pieza.secciones || []).map(function (s) {
      var html = limpiarHtmlAlumno(s.html || "", s.id, pieza.codigo);
      return Object.assign({}, s, { html: html, titulo: tituloSeccionAlumno(pieza, s) });
    }).filter(function (s) {
      return !!s.html;
    });
  }

  // ---------- Lección del recorrido desde cero ----------
  // Orden fijo de la sesión: Responde (escena y primera acción), Repara, Bloques
  // con voz, Practica (los pasos esenciales, en orden), Repite, Con Larsito, Cierre.
  // La práctica extra y las soluciones quedan plegadas: solo si se piden.
  function botonVozBloque(texto) {
    var b = el("button", "btn ghost voz-bloque", "Escuchar");
    b.type = "button";
    b.setAttribute("aria-label", "Escuchar «" + texto + "» con la voz del navegador");
    b.addEventListener("click", function () {
      window.NexoPractica.pararAudio();
      var v = window.NexoPractica.vozLocalNb();
      if (!v) { b.disabled = true; b.textContent = "Sin voz"; return; }
      var u = new SpeechSynthesisUtterance(texto);
      u.voice = v; u.lang = v.lang; u.rate = 0.85;
      speechSynthesis.speak(u);
    });
    return b;
  }

  function renderLeccion(pieza, secciones, lector) {
    var porId = {};
    secciones.forEach(function (s) { porId[s.id] = s; });
    var P = window.NexoPractica;
    var banco = P.banco(pieza, null);
    var esenciales = banco.esenciales || [];
    var deResponde = esenciales.filter(function (it) { return /#responde$/.test(String(it.fuente === "esencial" ? (pieza.meta.ejercicios.filter(function (e) { return e.id === it.id; })[0] || {}).fuente || "" : "")); });
    var idsResponde = {};
    deResponde.forEach(function (it) { idsResponde[it.id] = true; });
    var dePractica = esenciales.filter(function (it) { return !idsResponde[it.id]; });

    function seccionHtml(id, destino) {
      var s = porId[id];
      if (!s) return null;
      var bloque = el("section", "lector-seccion seccion-" + id);
      bloque.id = "apartado-" + id;
      bloque.appendChild(el("h2", null, s.titulo));
      var cuerpo = el("div", "seccion-cuerpo");
      cuerpo.innerHTML = s.html || "";
      bloque.appendChild(cuerpo);
      (destino || lector).appendChild(bloque);
      return bloque;
    }
    function sesion(items, kicker, encabezado, intro, destino) {
      if (!items.length) return;
      var hueco = el("div", "sesion-hueco");
      destino.appendChild(hueco);
      var opts = {
        estado: estado, guardar: guardar, kicker: kicker, encabezado: encabezado, intro: intro,
        alTerminar: function (registro) {
          if (registro.sesion && registro.sesion.aciertos === registro.sesion.total && items === dePractica && !estado.hechas[pieza.codigo]) { estado.hechas[pieza.codigo] = true; guardar(); }
        },
      };
      // montarEsenciales monta todos los esenciales; aquí se limita al subconjunto de esta parte.
      var nodo = P.montarEsenciales(pieza, Object.assign({}, opts, { soloFalladas: items.map(function (it) { return it.id; }) }));
      if (nodo) hueco.replaceWith(nodo); else hueco.remove();
    }

    var responde = seccionHtml("responde");
    if (responde) sesion(deResponde, "Responde", "Escucha y responde antes de leer nada más", "Dos escuchas. No hace falta entenderlo todo: busca solo los datos que se piden.", responde);
    seccionHtml("repara");
    var bloques = seccionHtml("bloques");
    if (bloques) {
      // La columna «Audio» de la tabla lleva ids de grabación; en la app cada bloque se puede oír con la voz local del navegador.
      var hayVoz = !!P.vozLocalNb();
      var filas = bloques.querySelectorAll("tbody tr");
      Array.prototype.forEach.call(filas, function (tr) {
        var celdas = tr.querySelectorAll("td");
        if (celdas.length < 3) return;
        var codigo = celdas[0].querySelector("code");
        if (!codigo) return;
        var texto = codigo.textContent.replace(/\s*…\s*$/, "").trim();
        celdas[2].textContent = "";
        if (hayVoz && texto) celdas[2].appendChild(botonVozBloque(texto));
        else celdas[2].appendChild(el("span", "sin-voz", "con el curso"));
      });
      var th = bloques.querySelectorAll("thead th");
      Array.prototype.forEach.call(th, function (h) { if (/^Audio$/i.test(h.textContent.trim())) h.textContent = hayVoz ? "Oír" : "Audio"; });
      bloques.appendChild(el("p", "audio-nota", hayVoz
        ? "La voz es la del navegador, provisional. Las grabaciones llegan con el curso."
        : "Este navegador no tiene voz en noruego; las grabaciones llegan con el curso."));
    }
    var practica = el("section", "lector-seccion seccion-practica");
    practica.id = "apartado-practica";
    practica.appendChild(el("h2", null, "Practica"));
    lector.appendChild(practica);
    sesion(dePractica, "Practica", "Ahora te toca a ti", dePractica.length + " pasos en orden. Cada uno te dice qué conservar y qué cambiar. Lo que falles vuelve mañana sin que lo apuntes.", practica);
    seccionHtml("repite");
    var larsito = seccionHtml("con-larsito");
    if (larsito && pieza.meta && pieza.meta.larsito) {
      var aL = el("a", "btn", "Abrir el escenario con Larsito");
      aL.href = "/norsk/larsito/" + QUERY_RUTA + "&escenario=" + encodeURIComponent(pieza.meta.larsito) + "&leccion=" + encodeURIComponent(pieza.codigo);
      larsito.appendChild(aL);
    }
    seccionHtml("cierre");

    var extra = document.createElement("details");
    extra.className = "lesson-apoyo practica-extra";
    var resumenExtra = document.createElement("summary");
    var copiaExtra = el("span", "lesson-apoyo-txt");
    copiaExtra.appendChild(el("span", "eti", "Solo si la pides"));
    copiaExtra.appendChild(el("strong", null, "Práctica extra: " + formatoNumero((banco.opcionales || []).length) + " ejercicios opcionales"));
    resumenExtra.appendChild(copiaExtra);
    resumenExtra.appendChild(el("span", "abrir", "Abrir"));
    extra.appendChild(resumenExtra);
    var interiorExtra = el("div", "lesson-apoyo-interior");
    extra.appendChild(interiorExtra);
    var montada = false;
    extra.addEventListener("toggle", function () {
      if (!extra.open || montada) return;
      montada = true;
      var nodo = P.montar(pieza, { estado: estado, guardar: guardar, anexoHtml: null });
      if (nodo) interiorExtra.appendChild(nodo);
    });
    lector.appendChild(extra);

    var apoyo = document.createElement("details");
    apoyo.className = "lesson-apoyo";
    var resumenApoyo = document.createElement("summary");
    var copiaApoyo = el("span", "lesson-apoyo-txt");
    copiaApoyo.appendChild(el("span", "eti", "Material de apoyo"));
    copiaApoyo.appendChild(el("strong", null, "La práctica en texto y las soluciones"));
    resumenApoyo.appendChild(copiaApoyo);
    resumenApoyo.appendChild(el("span", "abrir", "Abrir"));
    apoyo.appendChild(resumenApoyo);
    var interiorApoyo = el("div", "lesson-apoyo-interior");
    seccionHtml("practica", interiorApoyo);
    seccionHtml("soluciones", interiorApoyo);
    apoyo.appendChild(interiorApoyo);
    lector.appendChild(apoyo);
  }

  function renderPieza(pieza) {
    modoLector(true);
    limpiar();

    var fichaIndice = piezaEnIndice(pieza.codigo) || pieza;
    var abiertas = indice.filter(function (p) { return p.abierta && p.tipo !== "diagnostico"; });
    var posicion = abiertas.map(function (p) { return p.codigo; }).indexOf(pieza.codigo);

    var paso = el("article", "step lesson");
    var barraLeccion = el("div", "lesson-bar");
    barraLeccion.appendChild(volver("Volver al curso", renderIndice));
    if (posicion >= 0) barraLeccion.appendChild(el("span", "lesson-position", "Paso " + (posicion + 1) + " de " + abiertas.length));
    paso.appendChild(barraLeccion);

    var hero = el("header", "lesson-hero");
    hero.appendChild(el("p", "kicker", pieza.tipo === "diagnostico" ? "Opcional"
      : (pieza.tipo === "leccion" ? ((ZONAS[zonaDe(pieza)] || {}).titulo || "Lección") + (pieza.meta && pieza.meta.unidad ? " · Unidad " + String(pieza.meta.unidad).replace(/^.*-U0?/, "") : "")
        : ((TIPOS[pieza.tipo] || {}).titulo || pieza.tipo))));
    hero.appendChild(el("h1", null, pieza.titulo));
    if (fichaIndice.resumen) hero.appendChild(el("p", "lesson-lede", fichaIndice.resumen));

    var meta = pieza.meta || {};
    var chips = el("div", "meta-pieza");
    if (etiquetaCodigo(pieza)) chips.appendChild(el("span", null, etiquetaCodigo(pieza)));
    var destrezas = normalizarDestrezas(meta);
    if (destrezas.length) chips.appendChild(el("span", null, "Trabajas: " + destrezas.join(" · ")));
    hero.appendChild(chips);
    if (pieza.tipo === "mecanismo" && window.NexoPractica) {
      // Con el curso completo el total incluye el anexo de expresiones; en la demo, solo lo que hay en la pieza.
      var totalCta = conAcceso ? totalPracticaDe(pieza.codigo) : window.NexoPractica.banco(pieza, null).items.length;
      hero.appendChild(window.NexoPractica.llamada(pieza, estado, totalCta));
    }
    if (pieza.tipo === "leccion" && pieza.meta) {
      var fichaL = el("div", "leccion-ficha");
      if (pieza.meta.mision) { var fm = el("p", "leccion-mision"); fm.appendChild(el("b", null, "Misión. ")); fm.appendChild(document.createTextNode(pieza.meta.mision)); fichaL.appendChild(fm); }
      if (pieza.meta.evidencia) { var fe = el("p", "leccion-evidencia"); fe.appendChild(el("b", null, "Lo has hecho si… ")); fe.appendChild(document.createTextNode(pieza.meta.evidencia)); fichaL.appendChild(fe); }
      hero.appendChild(fichaL);
    }
    paso.appendChild(hero);

    var secciones = prepararSecciones(pieza);
    var lector = el("div", "lector");

    function renderSeccion(s, destino) {
      var bloque = el("section", "lector-seccion");
      bloque.id = "apartado-" + s.id;
      if (s.titulo) bloque.appendChild(el("h2", null, s.titulo));
      var cuerpo = el("div", "seccion-cuerpo");
      cuerpo.innerHTML = s.html || "";
      bloque.appendChild(cuerpo);
      (destino || lector).appendChild(bloque);
    }

    function insertarPractica(destino) {
      var huecoPractica = el("div", "practica-hueco");
      huecoPractica.appendChild(el("p", "ayuda", "Preparando los ejercicios…"));
      destino.appendChild(huecoPractica);
      var codigoAbierto = pieza.codigo;
      cargarPieza("ANEXO-UTTRYKK").then(function (anexo) {
        if (!huecoPractica.isConnected || estado.ultimaPieza !== codigoAbierto) return;
        var practica = window.NexoPractica.montar(pieza, {
          estado: estado,
          guardar: guardar,
          anexoHtml: window.NexoPractica.seccionAnexo(anexo, pieza.codigo),
          alTerminar: function (registro) {
            if (registro.ultimo && registro.ultimo.aciertos === registro.ultimo.total && !estado.hechas[pieza.codigo]) {
              estado.hechas[pieza.codigo] = true;
              guardar();
            }
          },
        });
        if (practica) huecoPractica.replaceWith(practica); else huecoPractica.remove();
      });
    }

    var jornadas = secciones.filter(function (s) { return /^jornada-\d+\b/.test(s.id || ""); });
    var lectorInsertado = false;
    if (pieza.codigo === "KIT_ORAL_21_JORNADAS" && jornadas.length === 21) {
      var noJornadas = secciones.filter(function (s) { return jornadas.indexOf(s) === -1; });
      var validas = jornadas.map(function (s) { return s.id; });
      validas.push("__guia__");
      var actual = estado.ultimaSeccion[pieza.codigo];
      if (validas.indexOf(actual) === -1) actual = jornadas[0].id;

      var ruta = el("div", "ruta21");
      ruta.appendChild(el("p", "lab", "Entrenamiento oral · 21 actuaciones"));
      var hechas21 = jornadas.filter(function (s) { return estado.actuaciones[s.id]; }).length;
      ruta.appendChild(el("p", "ruta21-progreso", hechas21 + " de 21 actuaciones marcadas"));
      var selector = document.createElement("select");
      selector.setAttribute("aria-label", "Elegir actuación o guía del entrenamiento oral");
      jornadas.forEach(function (s, i) {
        var op = document.createElement("option");
        op.value = s.id;
        op.textContent = (estado.actuaciones[s.id] ? "✓ " : "") + "Actuación " + (i + 1) + " · " + s.titulo.replace(/^Jornada\s+\d+\s*·?\s*/i, "");
        selector.appendChild(op);
      });
      var guia = document.createElement("option");
      guia.value = "__guia__";
      guia.textContent = "Guía, criterios y tablas";
      selector.appendChild(guia);
      selector.value = actual;
      selector.addEventListener("change", function () {
        estado.ultimaSeccion[pieza.codigo] = selector.value;
        guardar();
        renderPieza(pieza);
      });
      ruta.appendChild(selector);
      paso.appendChild(ruta);

      if (actual === "__guia__") {
        noJornadas.forEach(function (s) { renderSeccion(s); });
        paso.appendChild(lector);
        lectorInsertado = true;
      } else {
        var pos = validas.indexOf(actual);
        var jornada = jornadas[pos];
        renderSeccion(jornada);
        paso.appendChild(lector);
        lectorInsertado = true;

        var control = el("div", "marcar actuacion-control");
        var hecha = !!estado.actuaciones[jornada.id];
        control.appendChild(el("p", null, hecha
          ? "Esta actuación está marcada. El contenido de tu respuesta no se guarda."
          : "Márcala al terminar los dos intentos y anotar la recuperación."));
        var completar = el("button", "btn" + (hecha ? " ghost" : ""), hecha ? "Quitar la marca" : "Marcar actuación hecha");
        completar.addEventListener("click", function () {
          if (estado.actuaciones[jornada.id]) delete estado.actuaciones[jornada.id];
          else estado.actuaciones[jornada.id] = true;
          guardar();
          renderPieza(pieza);
        });
        control.appendChild(completar);
        paso.appendChild(control);

        var navAct = el("div", "nav-pieza nav-actuacion");
        var anterior = el("button", "btn ghost", "Actuación anterior");
        anterior.disabled = pos === 0;
        anterior.addEventListener("click", function () {
          estado.ultimaSeccion[pieza.codigo] = jornadas[pos - 1].id;
          guardar();
          renderPieza(pieza);
        });
        var siguiente = el("button", "btn ghost", pos === jornadas.length - 1 ? "Fin del entrenamiento" : "Siguiente actuación");
        siguiente.disabled = pos === jornadas.length - 1;
        siguiente.addEventListener("click", function () {
          estado.ultimaSeccion[pieza.codigo] = jornadas[pos + 1].id;
          guardar();
          renderPieza(pieza);
        });
        navAct.appendChild(anterior);
        navAct.appendChild(siguiente);
        paso.appendChild(navAct);
      }
    } else if (pieza.tipo === "leccion" && window.NexoPractica) {
      renderLeccion(pieza, secciones, lector);
    } else if (pieza.tipo === "mecanismo" && window.NexoPractica) {
      var idsEsenciales = { intro: true, "la-escena": true, "la-grieta": true, "el-mecanismo": true };
      var esenciales = secciones.filter(function (s) { return idsEsenciales[s.id]; });
      var ampliacion = secciones.filter(function (s) { return !idsEsenciales[s.id]; });
      esenciales.forEach(function (s) { renderSeccion(s); });
      insertarPractica(lector);

      if (ampliacion.length) {
        var apoyo = document.createElement("details");
        apoyo.className = "lesson-apoyo";
        var resumenApoyo = document.createElement("summary");
        var copiaApoyo = el("span", "lesson-apoyo-txt");
        copiaApoyo.appendChild(el("span", "eti", "Material de apoyo"));
        copiaApoyo.appendChild(el("strong", null, "Examen, vida real, modelos y soluciones"));
        resumenApoyo.appendChild(copiaApoyo);
        resumenApoyo.appendChild(el("span", "abrir", "Abrir"));
        apoyo.appendChild(resumenApoyo);
        var interiorApoyo = el("div", "lesson-apoyo-interior");
        ampliacion.forEach(function (s) { renderSeccion(s, interiorApoyo); });
        apoyo.appendChild(interiorApoyo);
        lector.appendChild(apoyo);
      }
    } else {
      secciones.forEach(function (s) { renderSeccion(s); });
    }
    if (!lectorInsertado) paso.appendChild(lector);

    var marcar = el("div", "marcar");
    var yaEsta = !!estado.hechas[pieza.codigo];
    marcar.appendChild(el("p", null, yaEsta
      ? (pieza.tipo === "diagnostico" ? "Diagnóstico revisado. Puedes volver cuando quieras." : "Esta pieza está marcada como hecha. Puedes volver sin perder nada.")
      : (pieza.tipo === "diagnostico" ? "Es opcional. Márcalo solo si te ha ayudado a elegir por dónde empezar." : "Márcala cuando hayas hecho la práctica, no solo cuando hayas llegado al final.")));
    var bm = el("button", "btn" + (yaEsta ? " ghost" : ""), yaEsta ? "Quitar la marca" : (pieza.tipo === "diagnostico" ? "Marcar como revisado" : "Marcar como hecha"));
    bm.addEventListener("click", function () {
      if (estado.hechas[pieza.codigo]) delete estado.hechas[pieza.codigo];
      else estado.hechas[pieza.codigo] = true;
      guardar();
      renderPieza(pieza);
    });
    marcar.appendChild(bm);
    paso.appendChild(marcar);

    if (posicion >= 0 && abiertas.length > 1) {
      var nav = el("nav", "nav-pieza");
      nav.setAttribute("aria-label", "Navegación entre piezas");

      var ant = el("button", "nav-card anterior");
      ant.disabled = posicion === 0;
      ant.appendChild(el("small", null, "← Anterior"));
      ant.appendChild(el("strong", null, posicion === 0 ? "Inicio del curso" : abiertas[posicion - 1].titulo));
      if (posicion > 0) ant.addEventListener("click", function () { abrirPieza(abiertas[posicion - 1].codigo); });

      var sig = el("button", "nav-card siguiente");
      sig.disabled = posicion === abiertas.length - 1;
      sig.appendChild(el("small", null, "Siguiente →"));
      sig.appendChild(el("strong", null, posicion === abiertas.length - 1 ? "Final del curso" : abiertas[posicion + 1].titulo));
      if (posicion < abiertas.length - 1) sig.addEventListener("click", function () { abrirPieza(abiertas[posicion + 1].codigo); });

      nav.appendChild(ant);
      nav.appendChild(sig);
      paso.appendChild(nav);
    }

    app.appendChild(paso);
    window.scrollTo({ top: 0, behavior: "auto" });
    enfocarTitulo();
    requestAnimationFrame(actualizarProgresoLectura);
  }

  // ---------- Errores ----------

  function error(msg) {
    modoLector(false);
    limpiar();
    var d = el("div", "error");
    d.appendChild(el("h1", null, "Vaya."));
    d.appendChild(el("p", "intro", msg));
    var b = el("button", "btn ghost", "Volver al curso");
    b.addEventListener("click", renderIndice);
    d.appendChild(b);
    app.appendChild(d);
    enfocarTitulo();
  }

  // ---------- Arranque ----------

  function desdeDemo(d) {
    demo = d;
    var piezas = [];

    if (d.mecanismo) {
      piezas.push(Object.assign({}, conTituloAlumno(d.mecanismo), {
        tipo: d.mecanismo.tipo || "mecanismo",
        orden: d.mecanismo.orden || 10,
        resumen: (d.mecanismo.meta && d.mecanismo.meta.grieta) || "",
        abierta: true,
      }));
    }
    if (d.diagnostico) {
      piezas.push(Object.assign({}, conTituloAlumno(d.diagnostico), {
        tipo: d.diagnostico.tipo || "diagnostico",
        orden: d.diagnostico.orden || 1,
        resumen: d.diagnostico.nota || "",
        abierta: true,
      }));
    }
    (d.piezas || []).forEach(function (p) {
      piezas.push(Object.assign({}, conTituloAlumno(p), { abierta: true, resumen: p.resumen || "" }));
    });

    var cerradas = (d.indice || []).map(function (p, i) {
      return {
        codigo: p.codigo,
        tipo: p.tipo || "mecanismo",
        titulo: tituloAlumno(p),
        orden: p.orden || (20 + i),
        resumen: p.grieta || p.resumen || "",
        zona: p.zona || null,
        abierta: false,
      };
    });

    indice = piezas.concat(cerradas).sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
    piezas.forEach(function (p) { cache[p.codigo] = p; });

    var vistaCompletaLocal = !!(d.meta && (d.meta.vista_completa_local || d.meta.modo === "revision_local_privada"));
    conAcceso = vistaCompletaLocal;
    chip.textContent = vistaCompletaLocal ? "Completo" : "Muestra";
    chip.className = vistaCompletaLocal ? "estado" : "estado demo";
    renderIndice();
  }

  function arrancar() {
    fetch(PRACTICA_META, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { practicaMeta = j; pintarDatoPractica(); })
      .catch(function () { practicaMeta = null; });
    // Solo se pregunta al servidor si el navegador lleva la marca de acceso
    // (cookie nexo_norsk_ok, que pone el servidor al activar la compra). Si no
    // la hay, o el servidor dice que no, se cae a la demo sin error en consola.
    var hayAcceso = /(?:^|;\s*)nexo_norsk_ok=/.test(document.cookie);
    (hayAcceso ? fetch(API_Q + "modo=indice", { credentials: "same-origin" }) : Promise.reject(new Error("sin acceso")))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.piezas) && d.piezas.length) {
          indice = d.piezas.map(function (p) { return Object.assign({}, conTituloAlumno(p), { abierta: true }); })
            .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
          conAcceso = true;
          chip.textContent = "Completo";
          chip.className = "estado";
          renderIndice();
          abrirDesdeHash();
          return null;
        }
        throw new Error("sin acceso");
      })
      .catch(function () {
        return fetch(DEMO, { credentials: "same-origin" })
          .then(function (r) { if (!r.ok) throw new Error("demo"); return r.json(); })
          .then(desdeDemo)
          .then(abrirDesdeHash)
          .catch(function () { error("El curso no está disponible ahora mismo. Vuelve a intentarlo en un rato."); });
      });
  }

  // Enlace directo a una pieza: /norsk/curso/#M09 (lo usan el informe de Larsito y el cuaderno).
  function abrirDesdeHash() {
    var m = /^#([A-Z0-9_-]{2,32})$/.exec(window.location.hash || "");
    if (m) abrirPieza(m[1]);
  }
  window.addEventListener("hashchange", abrirDesdeHash);

  arrancar();
})();

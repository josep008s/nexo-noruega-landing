// App del curso Norskprøven B1 de NEXO NORSK.
//
// Dos modos:
//   - Demo pública: muestra el diagnóstico, M01 y el mapa del curso.
//   - Con acceso: pide el índice y cada pieza al servidor protegido.
//
// El progreso se guarda solo en este navegador.
(function () {
  "use strict";

  var DEMO = "/data/norsk-curso-demo.json";
  var API = "/api/norsk-curso/";
  var CLAVE = "nexo_curso_v1";

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
      return e;
    } catch (err) {
      return { hechas: {}, actuaciones: {}, ultimaSeccion: {}, ultimaPieza: null, practica: {} };
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
    DIAGNOSTICO_B1: "Inicio",
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
    DIAGNOSTICO_B1: "Perfil diagnóstico por destrezas",
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
    return ETIQUETAS_CODIGO[pieza.codigo] || pieza.codigo.replace(/_v.*/, "").slice(0, 12);
  }

  var TIPOS = {
    diagnostico: { titulo: "Punto de partida", nota: "Localiza qué destreza necesita trabajo antes de abrir más material." },
    muntlig: { titulo: "Hablar", nota: "El entrenamiento oral: consignas y 21 actuaciones para sostener el turno, reparar y volver a intentarlo." },
    mecanismo: { titulo: "Los 16 mecanismos", nota: "El salto de A2 a B1, explicado desde situaciones que sí ocurren." },
    lytt: { titulo: "Escuchar", nota: "Escucha, decide y comprueba qué información cambia la respuesta." },
    les: { titulo: "Leer", nota: "Textos breves y largos para leer condiciones, intención y detalle." },
    skriv: { titulo: "Escribir", nota: "Tareas, modelos y criterios para escribir con dirección." },
    anexo: { titulo: "Banco de expresiones", nota: "Expresiones de UTTRYKK colocadas donde activan cada mecanismo." },
    simulacro: { titulo: "Simulacros", nota: "La prueba completa cuando ya toca medir el recorrido entero." },
    larsito: { titulo: "Practicar con Larsito", nota: "El compañero de conversación del entrenamiento oral: conversación, segundo intento e informe." },
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
    a.href = "/norsk/larsito/";
    franja.appendChild(a);
    return franja;
  }

  // ---------- Cuaderno en PDF (seis tomos) ----------
  // Los metadatos públicos (título, páginas, peso) vienen de /data/norsk-cuaderno.json.
  // Con acceso, cada tomo enlaza a /api/norsk-cuaderno/?tomo=N, que comprueba la
  // compra y redirige a una URL firmada de quince minutos. En la demo no se llama
  // a nada: se enseña lo que hay y se ofrece la muestra gratuita.
  var CUADERNO_META = "/data/norsk-cuaderno.json";
  var CUADERNO_API = "/api/norsk-cuaderno/";
  var CUADERNO_MUESTRA = "/norsk/curso/muestra/NEXO-NORSK_Cuaderno-B1_Muestra.pdf";

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
    if (!conAcceso) {
      var m = el("a", "btn cuaderno-muestra", "Descargar la muestra gratis (PDF)");
      m.href = CUADERNO_MUESTRA; m.setAttribute("download", "");
      sec.appendChild(m);
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
            fila.href = CUADERNO_API + "?tomo=" + t.n;
            fila.setAttribute("rel", "nofollow");
            fila.appendChild(el("span", "cuaderno-accion", "Descargar"));
          } else {
            fila.appendChild(el("span", "marca-est bloq", "Con el curso"));
          }
          lista.appendChild(fila);
        });
      })
      .catch(function () { /* sin metadatos no se pinta la lista; el bloque sigue teniendo sentido */ });
    return sec;
  }

  function renderIndice() {
    modoLector(false);
    limpiar();

    var paso = el("div", "step step-indice");
    var hero = el("section", "curso-hero");
    hero.appendChild(el("p", "kicker caesar", "Norskprøven B1"));

    var h1 = el("h1");
    h1.appendChild(document.createTextNode("De entender noruego a "));
    h1.appendChild(el("mark", "marcado", "sostenerlo hablando"));
    h1.appendChild(document.createTextNode("."));
    hero.appendChild(h1);

    hero.appendChild(el("p", "intro", conAcceso
      ? "Empieza por el diagnóstico o entra directamente en lo que hoy te frena. La ruta oral es el núcleo; lectura, escucha y escritura se abren cuando las necesitas."
      : "Abre el diagnóstico y el primer mecanismo. El resto del mapa te enseña cómo está construido el curso antes de que abra."));

    if (!conAcceso) {
      hero.appendChild(el("p", "nota-demo", "Vista de muestra. Lo abierto se lee entero; lo demás queda señalado sin enseñar el contenido de pago."));
    }

    var ultima = conAcceso && estado.ultimaPieza ? piezaEnIndice(estado.ultimaPieza) : null;
    if (ultima && ultima.abierta) {
      var continuar = el("button", "continuar");
      continuar.appendChild(document.createTextNode("Continuar "));
      continuar.appendChild(el("span", null, "· " + ultima.titulo));
      continuar.addEventListener("click", function () { abrirPieza(ultima.codigo); });
      hero.appendChild(continuar);
    }

    var datos = el("div", "curso-datos");
    datos.appendChild(renderDato("21", "actuaciones orales"));
    datos.appendChild(renderDato("16", "mecanismos B1"));
    datos.appendChild(renderDato("4", "destrezas conectadas"));
    hero.appendChild(datos);

    var abiertas = indice.filter(function (p) { return p.abierta; });
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
      hero.appendChild(pr);
    }
    paso.appendChild(hero);

    var recorrido = el("div", "recorrido");
    var numeroBloque = 0;
    ORDEN_TIPOS.forEach(function (tipo) {
      var piezas = indice.filter(function (p) { return p.tipo === tipo; });
      if (!piezas.length) return;
      numeroBloque++;
      var info = TIPOS[tipo] || { titulo: tipo, nota: "" };

      var bloque = el("section", "bloque bloque-" + tipo);
      var cab = el("div", "bloque-cab");
      cab.appendChild(el("span", "bloque-num", dosCifras(numeroBloque)));
      var tit = el("div", "bloque-tit");
      tit.appendChild(el("h2", null, info.titulo));
      if (info.nota) tit.appendChild(el("p", null, info.nota));
      cab.appendChild(tit);
      cab.appendChild(el("span", "cuenta", piezas.length === 1 ? "1 pieza" : piezas.length + " piezas"));
      bloque.appendChild(cab);

      var lista = el("div", "lista");
      piezas.forEach(function (p) {
        var b = el("button", "item");
        b.appendChild(el("span", "cod", etiquetaCodigo(p)));
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
        } else if (estado.practica && estado.practica[p.codigo] && estado.practica[p.codigo].mejor) {
          b.appendChild(el("span", "marca-est practica", "Práctica " + estado.practica[p.codigo].mejor.aciertos + "/" + estado.practica[p.codigo].mejor.total));
        } else {
          b.appendChild(el("span", "flecha", "→"));
        }

        if (p.abierta) b.addEventListener("click", function () { abrirPieza(p.codigo); });
        lista.appendChild(b);
      });
      bloque.appendChild(lista);
      if (tipo === "muntlig") bloque.appendChild(renderLarsito());
      recorrido.appendChild(bloque);
    });
    paso.appendChild(recorrido);
    paso.appendChild(renderCuaderno());

    if (!conAcceso) {
      var cierre = el("section", "cierre-demo");
      cierre.appendChild(el("h2", null, "El curso completo todavía no está a la venta."));
      cierre.appendChild(el("p", null, "Cuando abra, se avisará por correo. Sin cuenta atrás y sin urgencia fabricada."));
      var aS = el("a", "btn", "Avísame cuando abra");
      aS.href = "https://nexonoruega.substack.com/subscribe?utm_source=nexonoruega.com&utm_medium=web&utm_campaign=norsk-curso";
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

    fetch(API + "?modo=pieza&codigo=" + encodeURIComponent(codigo), { credentials: "same-origin" })
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
      && /(?:no es la prueba|no promete|no reproduce|no estamos vinculados|no tenemos relaci[oó]n)/i.test(plano);
  }

  function limpiarHtmlAlumno(html, seccionId) {
    var limpio = String(html || "");
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
      "DIAGNOSTICO_B1:como-hacer-este-perfil-opcional": "Cómo hacer el diagnóstico",
      "KIT_ORAL_21_JORNADAS:intro": "Cómo funciona la ruta",
      "SIMULACROS_LYTT_LES_SKRIV:convenciones-de-este-documento": "Cómo usar estos simulacros",
    };
    if (propios[clave]) return propios[clave];
    if (seccion.id === "nota-de-limites") return "Antes de empezar";
    if (seccion.id === "limites-de-este-documento") return "Qué practica esta ruta";
    if (seccion.id === "convenciones-de-este-documento") return "Cómo usar este material";
    // Cada archivo numeraba sus apartados a su manera ("1. La escena" en unos, "La escena" en otros).
    // Se quita la numeración de un nivel; la de dos niveles (1.1, 2.3) se conserva porque distingue simulacros.
    return String(seccion.titulo || "").replace(/^\d+\.\s+(?=\D)/, "");
  }

  function prepararSecciones(pieza) {
    return (pieza.secciones || []).map(function (s) {
      var html = limpiarHtmlAlumno(s.html || "", s.id);
      return Object.assign({}, s, { html: html, titulo: tituloSeccionAlumno(pieza, s) });
    }).filter(function (s) {
      return !!s.html;
    });
  }

  function renderPieza(pieza) {
    modoLector(true);
    limpiar();

    var fichaIndice = piezaEnIndice(pieza.codigo) || pieza;
    var abiertas = indice.filter(function (p) { return p.abierta; });
    var posicion = abiertas.map(function (p) { return p.codigo; }).indexOf(pieza.codigo);

    var paso = el("article", "step lesson");
    var barraLeccion = el("div", "lesson-bar");
    barraLeccion.appendChild(volver("Volver al curso", renderIndice));
    if (posicion >= 0) barraLeccion.appendChild(el("span", "lesson-position", "Pieza " + (posicion + 1) + " de " + abiertas.length));
    paso.appendChild(barraLeccion);

    var hero = el("header", "lesson-hero");
    hero.appendChild(el("p", "kicker", (TIPOS[pieza.tipo] || {}).titulo || pieza.tipo));
    hero.appendChild(el("h1", null, pieza.titulo));
    if (fichaIndice.resumen) hero.appendChild(el("p", "lesson-lede", fichaIndice.resumen));

    var meta = pieza.meta || {};
    var chips = el("div", "meta-pieza");
    chips.appendChild(el("span", null, etiquetaCodigo(pieza)));
    var destrezas = normalizarDestrezas(meta);
    if (destrezas.length) chips.appendChild(el("span", null, "Trabajas: " + destrezas.join(" · ")));
    hero.appendChild(chips);
    if (pieza.tipo === "mecanismo" && window.NexoPractica) hero.appendChild(window.NexoPractica.llamada(pieza, estado));
    paso.appendChild(hero);

    var secciones = prepararSecciones(pieza);
    var lector = el("div", "lector");

    function renderSeccion(s) {
      var bloque = el("section", "lector-seccion");
      bloque.id = "apartado-" + s.id;
      if (s.titulo) bloque.appendChild(el("h2", null, s.titulo));
      var cuerpo = el("div", "seccion-cuerpo");
      cuerpo.innerHTML = s.html || "";
      bloque.appendChild(cuerpo);
      lector.appendChild(bloque);
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
      selector.setAttribute("aria-label", "Elegir actuación o guía de la ruta oral");
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
        noJornadas.forEach(renderSeccion);
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
        var siguiente = el("button", "btn ghost", pos === jornadas.length - 1 ? "Fin de la ruta" : "Siguiente actuación");
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
    } else {
      secciones.forEach(renderSeccion);
    }
    if (!lectorInsertado) paso.appendChild(lector);

    if (pieza.tipo === "mecanismo" && window.NexoPractica) {
      var practica = window.NexoPractica.montar(pieza, {
        estado: estado,
        guardar: guardar,
        alTerminar: function (registro) {
          if (registro.ultimo && registro.ultimo.aciertos === registro.ultimo.total && !estado.hechas[pieza.codigo]) {
            estado.hechas[pieza.codigo] = true;
            guardar();
          }
        },
      });
      if (practica) paso.appendChild(practica);
    }

    var marcar = el("div", "marcar");
    var yaEsta = !!estado.hechas[pieza.codigo];
    marcar.appendChild(el("p", null, yaEsta
      ? "Esta pieza está marcada como hecha. Puedes volver sin perder nada."
      : "Márcala cuando hayas hecho la práctica, no solo cuando hayas llegado al final."));
    var bm = el("button", "btn" + (yaEsta ? " ghost" : ""), yaEsta ? "Quitar la marca" : "Marcar como hecha");
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
        abierta: false,
      };
    });

    indice = piezas.concat(cerradas).sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
    piezas.forEach(function (p) { cache[p.codigo] = p; });

    var vistaCompletaLocal = !!(d.meta && (d.meta.vista_completa_local || d.meta.modo === "revision_local_privada"));
    conAcceso = vistaCompletaLocal;
    chip.textContent = vistaCompletaLocal ? "Curso Pro" : "Demo";
    chip.className = vistaCompletaLocal ? "estado" : "estado demo";
    renderIndice();
  }

  function arrancar() {
    // Solo se pregunta al servidor si el navegador lleva la marca de acceso
    // (cookie nexo_norsk_ok, que pone el servidor al activar la compra). Si no
    // la hay, o el servidor dice que no, se cae a la demo sin error en consola.
    var hayAcceso = /(?:^|;\s*)nexo_norsk_ok=/.test(document.cookie);
    (hayAcceso ? fetch(API + "?modo=indice", { credentials: "same-origin" }) : Promise.reject(new Error("sin acceso")))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.piezas) && d.piezas.length) {
          indice = d.piezas.map(function (p) { return Object.assign({}, conTituloAlumno(p), { abierta: true }); })
            .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
          conAcceso = true;
          chip.textContent = "Curso Pro";
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

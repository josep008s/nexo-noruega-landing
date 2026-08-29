// App del curso Norskprøven B1 de NEXO NORSK.
//
// Dos modos, como en la app de PASS:
//   - Demo: sirve /data/norsk-curso-demo.json, que trae un mecanismo entero
//     y el índice del resto. No toca servidor y funciona sin cuenta.
//   - Con acceso: pide el índice y cada pieza a /api/norsk-curso/, que aplica
//     el muro de pago. Una pieza por llamada, nunca el curso entero.
//
// El progreso se guarda solo en este navegador. No se envía a ningún sitio.
(function () {
  "use strict";

  var DEMO = "/data/norsk-curso-demo.json";
  var API = "/api/norsk-curso/";
  var CLAVE = "nexo_curso_v1";

  var app = document.getElementById("app");
  var chip = document.getElementById("estado");

  var indice = [];      // [{codigo, tipo, titulo, orden, resumen, abierta}]
  var cache = {};       // codigo -> pieza completa
  var conAcceso = false;
  var demo = null;
  var estado = cargarEstado();

  // ---------- Estado local ----------

  function cargarEstado() {
    try {
      var e = JSON.parse(localStorage.getItem(CLAVE) || "{}");
      if (!e.hechas) e.hechas = {};
      return e;
    } catch (err) { return { hechas: {} }; }
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
  function volver(texto, fn) {
    var b = el("button", "back", "← " + texto);
    b.addEventListener("click", fn);
    return b;
  }

  var TIPOS = {
    diagnostico: { titulo: "Empieza por aquí", nota: "Mide dónde estás de verdad, destreza por destreza." },
    mecanismo: { titulo: "Los mecanismos", nota: "Los dieciséis saltos que separan el A2 del B1." },
    lytt: { titulo: "Comprensión oral", nota: "Escucha con el formato de la prueba." },
    les: { titulo: "Comprensión lectora", nota: "Textos y preguntas como los del examen." },
    skriv: { titulo: "Expresión escrita", nota: "Tareas modelo y cómo se corrige tu texto." },
    muntlig: { titulo: "Expresión oral", nota: "El entrenamiento diario y el banco de consignas." },
    simulacro: { titulo: "Simulacros", nota: "El examen entero, cronometrado." },
    larsito: { titulo: "Larsito", nota: "Conversación y escucha con el compañero de voz." },
  };
  var ORDEN_TIPOS = ["diagnostico", "mecanismo", "muntlig", "lytt", "les", "skriv", "simulacro"];

  // ---------- Pantalla: índice del curso ----------

  function renderIndice() {
    limpiar();
    var paso = el("div", "step");

    paso.appendChild(el("p", "kicker", "Norskprøven B1"));
    paso.appendChild(el("h1", null, "El curso"));
    paso.appendChild(el("p", "intro", conAcceso
      ? "Todo el material, ordenado. Puedes ir en orden o entrar directo a lo que te falla."
      : "Estás en la versión de demostración. Puedes leer entero el primer mecanismo y ver el mapa del resto."));

    if (!conAcceso) {
      var aviso = el("div", "aviso");
      aviso.appendChild(el("span", "eti", "Demo"));
      aviso.appendChild(el("p", null, (demo && demo.aviso) || "El curso completo se abre al comprar. Aquí puedes ver cómo está hecho por dentro."));
      paso.appendChild(aviso);
    }

    // progreso
    var abiertas = indice.filter(function (p) { return p.abierta; });
    var hechas = abiertas.filter(function (p) { return estado.hechas[p.codigo]; }).length;
    if (abiertas.length) {
      var pr = el("div", "progreso");
      pr.appendChild(el("p", "lab", "Tu avance"));
      var barra = el("div", "barra");
      var relleno = el("i");
      relleno.style.width = Math.round((hechas / abiertas.length) * 100) + "%";
      barra.appendChild(relleno);
      pr.appendChild(barra);
      pr.appendChild(el("p", null, hechas === 0
        ? "Todavía no has marcado ninguna pieza. Se marcan solas cuando las lees hasta el final."
        : "Llevas " + hechas + " de " + abiertas.length + (hechas === abiertas.length ? ". Has pasado por todo." : ".")));
      paso.appendChild(pr);
    }

    // bloques por tipo
    ORDEN_TIPOS.forEach(function (tipo) {
      var piezas = indice.filter(function (p) { return p.tipo === tipo; });
      if (!piezas.length) return;
      var info = TIPOS[tipo] || { titulo: tipo, nota: "" };

      var bloque = el("div", "bloque");
      var cab = el("div", "bloque-tit");
      cab.appendChild(el("h2", null, info.titulo));
      cab.appendChild(el("span", "cuenta", piezas.length === 1 ? "1 pieza" : piezas.length + " piezas"));
      bloque.appendChild(cab);
      if (info.nota) {
        var nota = el("p", null, info.nota);
        nota.style.cssText = "color:var(--tinta-suave);font-size:.96rem;margin-bottom:12px";
        bloque.appendChild(nota);
      }

      var lista = el("div", "lista");
      piezas.forEach(function (p) {
        var b = el("button", "item");
        b.appendChild(el("span", "cod", p.codigo.replace(/_v.*/, "").slice(0, 8)));
        var txt = el("span", "txt");
        txt.appendChild(document.createTextNode(p.titulo));
        if (p.resumen) {
          var s = el("small", null, p.resumen);
          txt.appendChild(s);
        }
        b.appendChild(txt);

        if (!p.abierta) {
          b.appendChild(el("span", "marca-est bloq", "Con el curso"));
          b.disabled = true;
          b.title = "Esta pieza se abre al comprar el curso";
        } else if (estado.hechas[p.codigo]) {
          b.appendChild(el("span", "marca-est hecho", "Leída"));
        }

        if (p.abierta) {
          b.addEventListener("click", function () { abrirPieza(p.codigo); });
        }
        lista.appendChild(b);
      });
      bloque.appendChild(lista);
      paso.appendChild(bloque);
    });

    // Larsito siempre disponible
    var extra = el("div", "bloque");
    var cabL = el("div", "bloque-tit");
    cabL.appendChild(el("h2", null, TIPOS.larsito.titulo));
    extra.appendChild(cabL);
    var notaL = el("p", null, TIPOS.larsito.nota);
    notaL.style.cssText = "color:var(--tinta-suave);font-size:.96rem;margin-bottom:12px";
    extra.appendChild(notaL);
    var aL = el("a", "btn ghost", "Practicar con Larsito");
    aL.href = "/norsk/larsito/";
    extra.appendChild(aL);
    paso.appendChild(extra);

    if (!conAcceso) {
      var cierre = el("div", "candado");
      cierre.style.marginTop = "26px";
      cierre.appendChild(el("h2", null, "El curso completo todavía no está a la venta."));
      cierre.appendChild(el("p", null, "Cuando abra, se avisa por correo. Sin cuenta atrás y sin prisa fabricada."));
      var aS = el("a", "btn", "Avísame cuando abra");
      aS.href = "https://nexonoruega.substack.com/subscribe";
      cierre.appendChild(aS);
      paso.appendChild(cierre);
    }

    app.appendChild(paso);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // ---------- Pantalla: lector de una pieza ----------

  function abrirPieza(codigo) {
    if (cache[codigo]) return renderPieza(cache[codigo]);

    limpiar();
    var cargando = el("div", "step");
    cargando.appendChild(el("p", "intro", "Abriendo…"));
    app.appendChild(cargando);

    if (!conAcceso) {
      var enDemo = (demo.piezas || []).filter(function (p) { return p.codigo === codigo; })[0];
      if (enDemo) { cache[codigo] = enDemo; return renderPieza(enDemo); }
      return error("Esta pieza es del curso completo.");
    }

    fetch(API + "?modo=pieza&codigo=" + encodeURIComponent(codigo), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.pieza) throw new Error(d && d.error ? d.error : "pieza");
        cache[codigo] = d.pieza;
        renderPieza(d.pieza);
      })
      .catch(function (e) {
        error(String(e.message) === "limite"
          ? "Has abierto muchas piezas hoy. Mañana vuelves a tener el cupo entero."
          : "No se ha podido abrir esta pieza. Vuelve a intentarlo en un momento.");
      });
  }

  function renderPieza(pieza) {
    limpiar();
    var paso = el("div", "step");
    paso.appendChild(volver("Volver al curso", renderIndice));

    paso.appendChild(el("p", "kicker", (TIPOS[pieza.tipo] || {}).titulo || pieza.tipo));
    paso.appendChild(el("h1", null, pieza.titulo));

    var meta = pieza.meta || {};
    var chips = el("div", "meta-pieza");
    if (meta.delprover) {
      var dp = meta.delprover;
      var texto = typeof dp === "string" ? dp : (dp.principal ? "Se evalúa en " + String(dp.principal).toLowerCase() : null);
      if (texto) chips.appendChild(el("span", null, texto));
    }
    if (meta.unidades_destino) {
      var u = [].concat(meta.unidades_destino).join(", ");
      if (u) chips.appendChild(el("span", null, "Unidad " + u));
    }
    if (meta.revision_nativa && String(meta.revision_nativa).toUpperCase() === "PENDIENTE") {
      var pend = el("span", null, "Pendiente de revisión nativa");
      pend.style.borderColor = "rgba(143,90,15,.4)";
      pend.style.color = "var(--alerta)";
      chips.appendChild(pend);
    }
    if (chips.children.length) paso.appendChild(chips);

    var lector = el("div", "lector");
    (pieza.secciones || []).forEach(function (s) {
      if (s.titulo) {
        var h = el("h2", null, s.titulo);
        lector.appendChild(h);
      }
      var caja = el("div");
      // El HTML lo genera nuestro exportador a partir del Markdown del curso,
      // no lo escribe nadie desde fuera.
      caja.innerHTML = s.html || "";
      lector.appendChild(caja);
    });
    paso.appendChild(lector);

    // marcar como leída
    var marcar = el("div", "marcar");
    var yaEsta = !!estado.hechas[pieza.codigo];
    marcar.appendChild(el("p", null, yaEsta
      ? "La tienes marcada como leída. Volver a ella no borra nada."
      : "Cuando la hayas trabajado de verdad, márcala. Lo que cuenta es haber hecho la práctica, no haber pasado la pantalla."));
    var bm = el("button", "btn" + (yaEsta ? " ghost" : ""), yaEsta ? "Quitar la marca" : "Marcar como leída");
    bm.addEventListener("click", function () {
      if (estado.hechas[pieza.codigo]) delete estado.hechas[pieza.codigo];
      else estado.hechas[pieza.codigo] = true;
      guardar();
      renderPieza(pieza);
    });
    marcar.appendChild(bm);
    paso.appendChild(marcar);

    // anterior y siguiente dentro del material abierto
    var abiertas = indice.filter(function (p) { return p.abierta; });
    var i = abiertas.map(function (p) { return p.codigo; }).indexOf(pieza.codigo);
    if (i >= 0 && abiertas.length > 1) {
      var nav = el("div", "nav-pieza");
      var ant = el("button", "btn ghost", "Anterior");
      ant.disabled = i === 0;
      ant.addEventListener("click", function () { abrirPieza(abiertas[i - 1].codigo); });
      var sig = el("button", "btn ghost", "Siguiente");
      sig.disabled = i === abiertas.length - 1;
      sig.addEventListener("click", function () { abrirPieza(abiertas[i + 1].codigo); });
      nav.appendChild(ant);
      nav.appendChild(sig);
      paso.appendChild(nav);
    }

    app.appendChild(paso);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // ---------- Errores ----------

  function error(msg) {
    limpiar();
    var d = el("div", "step");
    d.appendChild(el("h1", null, "Vaya."));
    d.appendChild(el("p", "intro", msg));
    var b = el("button", "btn ghost", "Volver al curso");
    b.addEventListener("click", renderIndice);
    d.appendChild(b);
    var a = el("a", "btn", "Ir a NEXO NORSK");
    a.href = "/norsk/";
    d.appendChild(a);
    app.appendChild(d);
  }

  // ---------- Arranque ----------

  function desdeDemo(d) {
    demo = d;
    var abiertas = (d.piezas || []).map(function (p) {
      return { codigo: p.codigo, tipo: p.tipo, titulo: p.titulo, orden: p.orden || 0, resumen: p.resumen || "", abierta: true };
    });
    var cerradas = (d.indice || []).map(function (p) {
      return { codigo: p.codigo, tipo: p.tipo, titulo: p.titulo, orden: p.orden || 0, resumen: p.resumen || "", abierta: false };
    });
    indice = abiertas.concat(cerradas).sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
    conAcceso = false;
    chip.textContent = "Demo";
    chip.className = "estado demo";
    renderIndice();
  }

  function arrancar() {
    // Primero se pregunta al servidor si hay acceso. Si dice que no, o si no
    // hay backend todavía, se cae a la demo sin dar error al usuario.
    fetch(API + "?modo=indice", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.piezas) && d.piezas.length) {
          indice = d.piezas.map(function (p) { return Object.assign({}, p, { abierta: true }); })
            .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
          conAcceso = true;
          chip.textContent = "Curso completo";
          chip.className = "estado";
          renderIndice();
          return null;
        }
        throw new Error("sin acceso");
      })
      .catch(function () {
        return fetch(DEMO, { credentials: "same-origin" })
          .then(function (r) { if (!r.ok) throw new Error("demo"); return r.json(); })
          .then(desdeDemo)
          .catch(function () { error("El curso no está disponible ahora mismo. Vuelve a intentarlo en un rato."); });
      });
  }

  arrancar();
})();

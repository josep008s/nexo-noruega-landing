// Práctica interactiva del curso B1 de NEXO NORSK.
//
// Genera ejercicios a partir del contenido ya revisado de cada mecanismo (nunca
// inventa noruego): los bloques para llevarte, la ficha T (modelo), la ficha P
// (práctica con soluciones) y la ficha E (evaluación de opción múltiple).
// Tipos: elegir la correcta, ordenar palabras arrastrando, completar el hueco,
// emparejar noruego y castellano, transformar una frase y escribirla.
// Todo ocurre en el navegador; el progreso se guarda en el estado local del curso
// (aciertos y tandas), nunca las respuestas escritas.
(function (root) {
  "use strict";

  var TANDA = 8;

  // ---------- Utilidades de texto ----------

  function decodificar(html) {
    var t = document.createElement("textarea");
    t.innerHTML = String(html || "");
    return t.value;
  }

  function plano(html) {
    return decodificar(String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }

  function planoConCodigo(html) {
    // Conserva las citas en noruego entre comillas para que el enunciado se entienda.
    return plano(String(html || "").replace(/<code>(.*?)<\/code>/g, "«$1»"));
  }

  function codigos(html) {
    var out = [];
    String(html || "").replace(/<code>([\s\S]*?)<\/code>/g, function (m, c) { out.push(decodificar(c).trim()); return m; });
    return out;
  }

  function tokens(frase) {
    return String(frase || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  }

  function normalizar(s) {
    return String(s || "").toLowerCase().replace(/[«»"“”]/g, "").replace(/\s+/g, " ").replace(/[.!?…,;:]+$/g, "").trim();
  }

  function distancia(a, b) {
    var m = a.length, n = b.length, i, j, prev, tmp;
    if (!m) return n; if (!n) return m;
    var fila = [];
    for (j = 0; j <= n; j++) fila[j] = j;
    for (i = 1; i <= m; i++) {
      prev = fila[0]; fila[0] = i;
      for (j = 1; j <= n; j++) {
        tmp = fila[j];
        fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return fila[n];
  }

  // Generador determinista: la misma pieza da la misma tanda hasta que se pide otra.
  function prng(semilla) {
    var s = (semilla >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function semillaDe(texto) {
    var h = 2166136261;
    for (var i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function barajar(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function elegirN(arr, n, rnd) { return barajar(arr, rnd).slice(0, n); }

  // ---------- Extracción del contenido de la pieza ----------

  function seccion(pieza, id) {
    var s = (pieza.secciones || []).filter(function (x) { return x.id === id; })[0];
    return s ? String(s.html || "") : "";
  }

  function bloqueDeFicha(html, letra) {
    // Trozo de la sección que va desde "Ficha X" (h3 o párrafo en negrita) hasta la ficha siguiente.
    var re = new RegExp("(?:<h3[^>]*>\\s*Ficha " + letra + "\\b|<p><strong>Ficha " + letra + "\\.?<\\/strong>)[\\s\\S]*?(?=<h3|<p><strong>Ficha [A-Z]\\b|$)", "i");
    var m = re.exec(html);
    return m ? m[0] : "";
  }

  function filas(tablaHtml) {
    var out = [];
    String(tablaHtml || "").replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, function (m, fila) {
      var celdas = [];
      fila.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, function (mm, c) { celdas.push(c); return mm; });
      out.push(celdas);
      return m;
    });
    return out;
  }

  function nombresPropios(pieza) {
    var set = {};
    (pieza.secciones || []).forEach(function (s) {
      codigos(s.html).forEach(function (c) {
        c.split(/(?<=[.!?])\s+/).forEach(function (frase) {
          tokens(frase).forEach(function (t, i) {
            var limpio = t.replace(/^[«"(]+|[»".,!?;:)]+$/g, "");
            if (i > 0 && /^[A-ZÆØÅ][a-zæøå]/.test(limpio)) set[limpio] = true;
          });
        });
      });
    });
    return set;
  }

  function sinPuntosSuspensivos(t) {
    return String(t || "").replace(/\s*(?:\.\.\.|…)\s*$/, "").replace(/^\s*(?:\.\.\.|…)\s*/, "").trim();
  }

  function extraerBloques(pieza) {
    var html = seccion(pieza, "bloques-para-llevarte");
    var pares = [];
    filas(html).forEach(function (celdas) {
      if (celdas.length < 2) return;
      // La celda con noruego es la primera que lleva <code>; el castellano, la siguiente sin <code>.
      var iNo = -1;
      for (var i = 0; i < celdas.length; i++) { if (/<code>/.test(celdas[i])) { iNo = i; break; } }
      if (iNo < 0 || iNo + 1 >= celdas.length) return;
      if (/herramienta/i.test(plano(celdas[0]))) return;
      var cs = codigos(celdas[iNo]);
      if (cs.length !== 1 || / y <code>/.test(celdas[iNo])) return;
      var parcial = /(?:\.\.\.|…)\s*$/.test(cs[0]);
      var no = sinPuntosSuspensivos(cs[0]);
      var es = sinPuntosSuspensivos(plano(celdas[iNo + 1]));
      if (/<code>/.test(celdas[iNo + 1])) return;
      var n = tokens(no).length;
      if (n < 3 || n > 14 || !es || es.length > 140) return;
      pares.push({ no: no, es: es, parcial: parcial });
    });
    return pares;
  }

  function extraerFichaT(pieza) {
    var html = seccion(pieza, "practica");
    var bloque = bloqueDeFicha(html, "T");
    var out = [];
    function valida(frase) { var n = tokens(frase).length; return n >= 3 && n <= 14; }
    // Forma de tabla: # | entrada | salida | motivo (o # | frase | motivo)
    var tabla = /<table>[\s\S]*?<\/table>/i.exec(bloque);
    if (tabla) {
      var fs = filas(tabla[0]);
      var cab = fs.length ? fs[0].map(plano) : [];
      fs.slice(1).forEach(function (celdas) {
        if (cab.length >= 4 && celdas.length >= 4) {
          var ent = codigos(celdas[1]), sal = codigos(celdas[2]);
          if (ent.length === 1 && sal.length === 1 && valida(sal[0])) out.push({ entrada: ent[0], salida: sal[0], motivo: planoConCodigo(celdas[3]), etqEntrada: cab[1], etqSalida: cab[2] });
        } else if (cab.length === 3 && celdas.length >= 3) {
          var cs = codigos(celdas[1]);
          if (cs.length === 1 && valida(cs[0])) out.push({ salida: cs[0], motivo: planoConCodigo(celdas[2]) });
        }
      });
      if (out.length) return out;
    }
    // Forma de párrafo, en sus variantes.
    var re = /<p><strong>T\d+[^<]*<\/strong>([\s\S]*?)<\/p>/gi, m;
    while ((m = re.exec(bloque))) {
      var cuerpo = m[1];
      var base = /Base:\s*<code>([\s\S]*?)<\/code>([\s\S]*?)<br\s*\/?>\s*Resuelto:\s*<code>([\s\S]*?)<\/code>([\s\S]*?)(?:<br\s*\/?>\s*Motivo:\s*([\s\S]*))?$/i.exec(cuerpo);
      if (base) {
        if (valida(base[3])) out.push({ entrada: decodificar(base[1]).trim(), instruccion: plano(base[2]), salida: decodificar(base[3]).trim(), motivo: planoConCodigo(base[5] || ""), etqEntrada: "Base", etqSalida: "Resuelto" });
        continue;
      }
      var corrige = /Lo que sale solo:\s*<code>([\s\S]*?)<\/code>[\s\S]*?Lo que resuelve:\s*<code>([\s\S]*?)<\/code>([\s\S]*)$/i.exec(cuerpo);
      if (corrige) {
        var quiere = /Quieres decir:\s*([\s\S]*?)<br/i.exec(cuerpo);
        var porque = /Por qué:\s*([\s\S]*?)(?:<br\s*\/?>\s*Por qué no la otra|$)/i.exec(corrige[3]);
        if (valida(corrige[2])) out.push({ entrada: decodificar(corrige[1]).trim(), instruccion: quiere ? "Quieres decir: " + plano(quiere[1]) : "", salida: decodificar(corrige[2]).trim(), motivo: porque ? planoConCodigo(porque[1]) : planoConCodigo(corrige[3]), etqEntrada: "Lo que sale solo", etqSalida: "Lo que resuelve" });
        continue;
      }
      // Situación en castellano + frase resuelta (o frase resuelta + explicación).
      var primero = /<code>([\s\S]*?)<\/code>/.exec(cuerpo);
      if (!primero || !valida(primero[1])) continue;
      var antes = plano(cuerpo.slice(0, primero.index)).replace(/^[\s·.:-]+/, "");
      var despues = planoConCodigo(cuerpo.slice(primero.index + primero[0].length)).replace(/^\s*\(B1-P[^)]*\)\s*/, "").replace(/^[\s·.:-]+/, "");
      out.push({ salida: decodificar(primero[1]).trim(), pista: antes.length >= 12 && !/^Pieza|^Criterio/i.test(antes) ? antes : "", motivo: despues });
    }
    return out;
  }

  function itemsNumerados(bloque, prefijoLetra, exigeCodigo) {
    // Devuelve [{n, html}] tanto si las respuestas van en <li> como en párrafos con <strong>P1.</strong>.
    var out = [], m;
    var vistos = {};
    var reLi = /<li>([\s\S]*?)<\/li>/gi;
    while ((m = reLi.exec(bloque))) {
      var li = m[1];
      var num = new RegExp("^\\s*<strong>" + prefijoLetra + "(\\d+)\\.<\\/strong>\\s*").exec(li);
      var n = num ? Number(num[1]) : null;
      var cuerpo = num ? li.slice(num[0].length) : li;
      if (exigeCodigo && !/^\s*<code>/.test(cuerpo)) continue;
      out.push({ n: n, html: cuerpo });
      if (n) vistos[n] = true;
    }
    if (out.length) {
      // Numeración por orden si el <ol> no la lleva (respeta start="5").
      var contador = 0;
      var arranques = [];
      bloque.replace(/<ol(?:\s+start="(\d+)")?>/gi, function (mm, st) { arranques.push(st ? Number(st) : null); return mm; });
      out.forEach(function (it, i) { if (!it.n) { it.n = ++contador; } });
      return out;
    }
    var reP = new RegExp("<strong>" + prefijoLetra + "(\\d+)\\.<\\/strong>\\s*([\\s\\S]*?)(?=<br\\s*\\/?>\\s*<strong>" + prefijoLetra + "\\d+\\.|<\\/p>)", "gi");
    while ((m = reP.exec(bloque))) {
      if (exigeCodigo && !/^\s*<code>/.test(m[2])) continue;
      out.push({ n: Number(m[1]), html: m[2] });
    }
    return out;
  }

  function extraerFichaP(pieza) {
    var pr = bloqueDeFicha(seccion(pieza, "practica"), "P");
    var so = bloqueDeFicha(seccion(pieza, "soluciones"), "P");
    var out = [];
    if (!pr || !so) return out;
    var enunciados = itemsNumerados(pr, "P", false);
    var soluciones = itemsNumerados(so, "P", true);
    if (!enunciados.length || !soluciones.length) return out;
    var porNumero = {};
    enunciados.forEach(function (e, i) { porNumero[e.n || (i + 1)] = e; });
    soluciones.forEach(function (sol, i) {
      var en = porNumero[sol.n || (i + 1)] || enunciados[i];
      if (!en) return;
      var mm = /^\s*<code>([\s\S]*?)<\/code>([\s\S]*)$/.exec(sol.html);
      if (!mm || /respuesta libre/i.test(plano(sol.html))) return;
      var resp = decodificar(mm[1]).trim();
      var n = tokens(resp).length;
      if (n < 3 || n > 16) return;
      out.push({ n: sol.n || (i + 1), enunciado: planoConCodigo(en.html), respuesta: resp, explicacion: planoConCodigo(mm[2]) });
    });
    return out;
  }

  function extraerFichaE(pieza) {
    var pr = bloqueDeFicha(seccion(pieza, "practica"), "E");
    var so = bloqueDeFicha(seccion(pieza, "soluciones"), "E");
    var out = [];
    if (!pr || !so) return out;
    var claves = {}, m;
    var reS = /<strong>E(\d+):\s*([a-d])\.<\/strong>\s*([\s\S]*?)<\/p>/gi;
    while ((m = reS.exec(so))) claves[m[1]] = { letra: m[2], explicacion: planoConCodigo(m[3]) };
    var contexto = null, tituloContexto = null;
    var partes = pr.match(/<(p|blockquote)>[\s\S]*?<\/\1>/gi) || [];
    partes.forEach(function (parte) {
      var texto = /^<p><strong>Texto\s+([A-Z])\b[^<]*<\/strong>/i.exec(parte);
      if (texto) { tituloContexto = plano(parte); contexto = null; return; }
      if (/^<blockquote>/i.test(parte) && tituloContexto) {
        contexto = { titulo: tituloContexto, texto: decodificar(parte.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/^\s*Guion de escucha [A-Z0-9-]+:\s*/i, "").trim() };
        return;
      }
      var item = /^<p><strong>E(\d+)\.<\/strong>\s*([\s\S]*)<\/p>$/i.exec(parte);
      if (!item || !claves[item[1]]) return;
      var cuerpo = item[2];
      var pregunta, opciones = [], resto;
      if (/<br\s*\/?>\s*a\)/i.test(cuerpo)) {
        // Opciones tras un salto de línea: en una sola línea separadas por comas o una por línea.
        var trozos = cuerpo.split(/<br\s*\/?>/i);
        pregunta = plano(trozos[0]);
        resto = trozos.slice(1).map(planoConCodigo).join(" ");
      } else {
        var tp = planoConCodigo(cuerpo);
        var ix = tp.search(/\ba\)\s/);
        if (ix < 0) return;
        pregunta = tp.slice(0, ix).trim();
        resto = tp.slice(ix);
      }
      var ops = resto.split(/\s*(?:^|[,;]\s+|\s)(?=[a-d]\)\s)/).filter(Boolean);
      ops.forEach(function (o) { var op = /^([a-d])\)\s*([\s\S]*)$/.exec(o.trim()); if (op) opciones.push(op[2].replace(/[,.]\s*$/, "").trim()); });
      if (opciones.length < 3 || opciones.length > 4) return;
      var correcta = "abcd".indexOf(claves[item[1]].letra);
      if (correcta < 0 || correcta >= opciones.length) return;
      out.push({ n: Number(item[1]), pregunta: pregunta, opciones: opciones, correcta: correcta, explicacion: claves[item[1]].explicacion, contexto: contexto });
    });
    return out;
  }

  function extraer(pieza) {
    return {
      propios: nombresPropios(pieza),
      bloques: extraerBloques(pieza),
      fichaT: extraerFichaT(pieza),
      fichaP: extraerFichaP(pieza),
      fichaE: extraerFichaE(pieza),
    };
  }

  // ---------- Construcción de ejercicios ----------

  var FUNCIONALES = ["at", "om", "som", "fordi", "hvis", "når", "da", "derfor", "ikke", "men", "og", "eller", "for", "så", "at", "selv om", "mens", "etter", "før", "sin", "si", "sitt", "sine", "hans", "hennes", "deres", "det", "den", "de", "må", "kan", "skal", "vil", "bør", "kunne", "måtte", "skulle", "ville", "har", "hadde", "er", "var", "blir", "ble", "alltid", "bare", "ofte", "aldri", "også", "ennå", "nok", "vel", "jo", "kanskje", "ganske", "litt", "veldig", "mye", "mange", "noen", "ingen", "ingenting", "alle", "hver", "flere", "både", "enten", "verken"];

  function primerToken(t, propios) {
    var limpio = t.replace(/[.,!?;:]+$/, "");
    if (propios[limpio] || /^[A-ZÆØÅ]{2,}$/.test(limpio)) return t;
    return t.charAt(0).toLowerCase() + t.slice(1);
  }

  function fichasOrdena(frase, propios) {
    var ts = tokens(frase);
    var sol = ts.map(function (t, i) { return i === 0 ? primerToken(t, propios) : t; });
    return sol;
  }

  function itemOrdena(par, propios, rnd, prefijo) {
    var sol = fichasOrdena(par.no, propios);
    var mezcla = barajar(sol, rnd);
    var intentos = 0;
    while (mezcla.join(" ") === sol.join(" ") && intentos++ < 5) mezcla = barajar(sol, rnd);
    return { tipo: "ordena", id: prefijo + ":ordena:" + semillaDe(par.no), pista: par.es, parcial: !!par.parcial, motivo: par.motivo || "", fichas: mezcla, solucion: sol, frase: par.no };
  }

  function itemTransforma(t, propios, rnd, prefijo) {
    var sol = fichasOrdena(t.salida, propios);
    var mezcla = barajar(sol, rnd);
    var intentos = 0;
    while (mezcla.join(" ") === sol.join(" ") && intentos++ < 5) mezcla = barajar(sol, rnd);
    return { tipo: "transforma", id: prefijo + ":transforma:" + semillaDe(t.salida), entrada: t.entrada, instruccion: t.instruccion || "", etqEntrada: t.etqEntrada, etqSalida: t.etqSalida, fichas: mezcla, solucion: sol, frase: t.salida, motivo: t.motivo };
  }

  function itemCompleta(par, todos, rnd, prefijo) {
    var ts = tokens(par.no);
    var candidatos = [];
    ts.forEach(function (t, i) {
      var limpio = t.toLowerCase().replace(/[.,!?;:]+$/, "");
      if (i > 0 && FUNCIONALES.indexOf(limpio) >= 0) candidatos.push(i);
    });
    if (!candidatos.length) candidatos = ts.map(function (_, i) { return i; }).filter(function (i) { return i > 0 && i < ts.length - 1; });
    if (!candidatos.length) return null;
    var idx = candidatos[Math.floor(rnd() * candidatos.length)];
    var respuesta = ts[idx].replace(/[.,!?;:]+$/, "");
    var puntuacion = ts[idx].slice(respuesta.length);
    // Distractores de la misma familia: palabras de función si el hueco es de función,
    // y si no, palabras de contenido de otras frases de la misma pieza.
    var esFuncional = FUNCIONALES.indexOf(respuesta.toLowerCase()) >= 0;
    var pool = {};
    if (esFuncional) {
      FUNCIONALES.forEach(function (f) { if (f.indexOf(" ") < 0) pool[f] = true; });
    } else {
      todos.forEach(function (p) {
        if (p.no === par.no) return;
        tokens(p.no).forEach(function (t) {
          var l = t.toLowerCase().replace(/[.,!?;:«»]+$/, "").replace(/^[«"]+/, "");
          if (l.length >= 3 && FUNCIONALES.indexOf(l) < 0 && !/\d/.test(l) && !/^[A-ZÆØÅ]/.test(t)) pool[l] = true;
        });
      });
      if (Object.keys(pool).length < 3) FUNCIONALES.forEach(function (f) { if (f.indexOf(" ") < 0) pool[f] = true; });
    }
    delete pool[respuesta.toLowerCase()];
    var distractores = elegirN(Object.keys(pool), 3, rnd);
    if (distractores.length < 2) return null;
    var opciones = barajar([respuesta].concat(distractores), rnd);
    return { tipo: "completa", id: prefijo + ":completa:" + semillaDe(par.no) + ":" + idx, antes: ts.slice(0, idx), despues: ts.slice(idx + 1), puntuacion: puntuacion, respuesta: respuesta, opciones: opciones, es: par.es, frase: par.no };
  }

  function itemEmpareja(pares, rnd, prefijo) {
    var sel = elegirN(pares, 4, rnd);
    if (sel.length < 3) return null;
    return { tipo: "empareja", id: prefijo + ":empareja:" + sel.map(function (p) { return semillaDe(p.no); }).join("-"), pares: sel, derecha: barajar(sel.map(function (p) { return p.es; }), rnd) };
  }

  function itemEscribe(p, propios, rnd, prefijo) {
    return { tipo: "escribe", id: prefijo + ":escribe:" + p.n, enunciado: p.enunciado, respuesta: p.respuesta, explicacion: p.explicacion, fichas: barajar(fichasOrdena(p.respuesta, propios), rnd), solucion: fichasOrdena(p.respuesta, propios) };
  }

  function itemMc(e, prefijo) {
    return { tipo: "mc", id: prefijo + ":mc:" + e.n, pregunta: e.pregunta, opciones: e.opciones, correcta: e.correcta, explicacion: e.explicacion, contexto: e.contexto };
  }

  function generar(pieza, semilla) {
    var datos = extraer(pieza);
    var rnd = prng(semillaDe(pieza.codigo + ":" + (semilla || 0)));
    var prefijo = pieza.codigo;
    var items = [];
    var mc = elegirN(datos.fichaE, 2, rnd).map(function (e) { return itemMc(e, prefijo); });
    var conEntrada = datos.fichaT.filter(function (t) { return t.entrada; });
    var sinEntrada = datos.fichaT.filter(function (t) { return !t.entrada; });
    var tr = elegirN(conEntrada, 2, rnd).map(function (t) { return itemTransforma(t, datos.propios, rnd, prefijo); })
      .concat(elegirN(sinEntrada, 2 - Math.min(2, conEntrada.length), rnd).map(function (t) { return itemOrdena({ no: t.salida, es: t.pista || "", motivo: t.motivo }, datos.propios, rnd, prefijo + ":T"); }));
    var bl = barajar(datos.bloques, rnd);
    var emp = bl.length >= 3 ? [itemEmpareja(bl, rnd, prefijo)].filter(Boolean) : [];
    var ord = bl.slice(0, 2).map(function (p) { return itemOrdena(p, datos.propios, rnd, prefijo); });
    var com = bl.slice(2, 4).map(function (p) { return itemCompleta(p, datos.bloques, rnd, prefijo); }).filter(Boolean);
    var esc = elegirN(datos.fichaP, 1, rnd).map(function (p) { return itemEscribe(p, datos.propios, rnd, prefijo); });
    // Orden pedagógico: reconocer, después construir, después producir.
    items = items.concat(mc.slice(0, 1), emp, ord.slice(0, 1), com.slice(0, 1), tr.slice(0, 1), mc.slice(1), ord.slice(1), com.slice(1), tr.slice(1), esc);
    // Relleno si la pieza tiene pocas fuentes.
    var extra = bl.slice(4);
    var k = 0;
    while (items.length < TANDA && k < extra.length) {
      var it = k % 2 === 0 ? itemOrdena(extra[k], datos.propios, rnd, prefijo) : itemCompleta(extra[k], datos.bloques, rnd, prefijo);
      if (it) items.push(it);
      k++;
    }
    return { items: items.slice(0, TANDA), fuentes: { bloques: datos.bloques.length, fichaT: datos.fichaT.length, fichaP: datos.fichaP.length, fichaE: datos.fichaE.length } };
  }

  // ---------- Interfaz ----------

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }

  function vibrar(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (err) { /* nada */ } }

  // Arrastre con Pointer Events y alternativa por toque/teclado (tocar una ficha la coloca).
  function hacerArrastrable(ficha, opciones) {
    var arrastrando = false, clon = null, inicioX = 0, inicioY = 0, moved = false;
    ficha.setAttribute("draggable", "false");
    ficha.addEventListener("pointerdown", function (e) {
      if (ficha.disabled) return;
      inicioX = e.clientX; inicioY = e.clientY; moved = false; arrastrando = true;
      try { ficha.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    });
    ficha.addEventListener("pointermove", function (e) {
      if (!arrastrando) return;
      var dx = e.clientX - inicioX, dy = e.clientY - inicioY;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      if (!moved) {
        moved = true;
        clon = ficha.cloneNode(true);
        clon.className += " ficha-flotante";
        var r = ficha.getBoundingClientRect();
        clon.style.width = r.width + "px";
        clon.style.left = r.left + "px";
        clon.style.top = r.top + "px";
        document.body.appendChild(clon);
        ficha.classList.add("ficha-origen");
        if (opciones.alEmpezar) opciones.alEmpezar(ficha);
      }
      e.preventDefault();
      clon.style.transform = "translate(" + dx + "px," + dy + "px)";
      if (opciones.alMover) opciones.alMover(ficha, e.clientX, e.clientY);
    });
    function terminar(e) {
      if (!arrastrando) return;
      arrastrando = false;
      try { ficha.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
      if (moved) {
        if (clon) { clon.remove(); clon = null; }
        ficha.classList.remove("ficha-origen");
        var destino = document.elementFromPoint(e.clientX, e.clientY);
        opciones.alSoltar(ficha, destino, e.clientX, e.clientY);
      } else if (e.type === "pointerup") {
        // Toque sin arrastre: alternativa accesible.
        opciones.alTocar(ficha);
      }
    }
    ficha.addEventListener("pointerup", terminar);
    ficha.addEventListener("pointercancel", terminar);
    ficha.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!ficha.disabled) opciones.alTocar(ficha); }
    });
  }

  function botonFicha(texto) {
    var b = el("button", "ficha", texto);
    b.type = "button";
    b.lang = "nb";
    return b;
  }

  function comparadorDeOrden(objetivo) {
    return function (a, b) { return objetivo.indexOf(a) - objetivo.indexOf(b); };
  }

  // Ordenar palabras (también sirve para transformar y para la pista de escribir).
  function montarOrdena(item, caja, alResolver) {
    var solucion = item.solucion;
    var linea = el("div", "linea-respuesta");
    linea.setAttribute("aria-label", "Tu frase. Toca una palabra para quitarla.");
    var banco = el("div", "banco-fichas");
    banco.setAttribute("aria-label", "Palabras disponibles. Toca una para añadirla a la frase.");
    var fichas = item.fichas.map(function (t) {
      var f = botonFicha(t);
      banco.appendChild(f);
      return f;
    });

    function indiceDeInsercion(x, y) {
      var hijos = Array.prototype.slice.call(linea.children);
      for (var i = 0; i < hijos.length; i++) {
        var r = hijos[i].getBoundingClientRect();
        if (y < r.top - 4) return i;
        if (y <= r.bottom + 4 && x < r.left + r.width / 2) return i;
      }
      return hijos.length;
    }
    function mover(f, destino, x, y) {
      if (destino === linea || (destino && linea.contains(destino))) {
        var idx = indiceDeInsercion(x, y);
        var ref = linea.children[idx] || null;
        if (ref === f) return;
        linea.insertBefore(f, ref);
      } else if (destino === banco || (destino && banco.contains(destino))) {
        banco.appendChild(f);
      }
      actualizar();
    }
    function tocar(f) {
      if (f.parentNode === linea) banco.appendChild(f); else linea.appendChild(f);
      actualizar();
    }
    fichas.forEach(function (f) {
      hacerArrastrable(f, {
        alSoltar: function (ficha, destino, x, y) { mover(ficha, destino, x, y); },
        alTocar: tocar,
        alMover: function (ficha, x, y) {
          var sobre = document.elementFromPoint(x, y);
          linea.classList.toggle("destino", !!(sobre && (sobre === linea || linea.contains(sobre))));
        },
      });
    });

    var comprobar = el("button", "btn", "Comprobar");
    comprobar.type = "button";
    comprobar.disabled = true;
    function actualizar() {
      linea.classList.remove("destino");
      comprobar.disabled = linea.children.length !== solucion.length;
      linea.classList.toggle("vacia", !linea.children.length);
    }
    actualizar();

    comprobar.addEventListener("click", function () {
      var dado = Array.prototype.map.call(linea.children, function (c) { return c.textContent; });
      var bien = normalizar(dado.join(" ")) === normalizar(solucion.join(" "));
      Array.prototype.forEach.call(linea.children, function (c, i) {
        c.classList.toggle("bien", normalizar(c.textContent) === normalizar(solucion[i]));
        c.classList.toggle("mal", normalizar(c.textContent) !== normalizar(solucion[i]));
      });
      fichas.forEach(function (f) { f.disabled = true; });
      comprobar.disabled = true;
      alResolver(bien, dado.join(" "));
    });

    caja.appendChild(linea);
    caja.appendChild(banco);
    caja.appendChild(comprobar);
    return { deshabilitar: function () { fichas.forEach(function (f) { f.disabled = true; }); comprobar.disabled = true; } };
  }

  function montarCompleta(item, caja, alResolver) {
    var frase = el("p", "frase-hueco");
    frase.lang = "nb";
    frase.appendChild(document.createTextNode(item.antes.join(" ") + " "));
    var hueco = el("span", "hueco vacio", "…");
    hueco.setAttribute("role", "button");
    hueco.setAttribute("aria-label", "Hueco. Toca una palabra para colocarla aquí.");
    frase.appendChild(hueco);
    frase.appendChild(document.createTextNode(item.puntuacion + " " + item.despues.join(" ")));
    var banco = el("div", "banco-fichas");
    var fichas = item.opciones.map(function (t) { var f = botonFicha(t); banco.appendChild(f); return f; });
    var colocada = null;

    function colocar(f) {
      if (colocada) { colocada.disabled = false; colocada.classList.remove("usada"); }
      colocada = f;
      f.classList.add("usada");
      hueco.textContent = f.textContent;
      hueco.classList.remove("vacio");
      comprobar.disabled = false;
    }
    fichas.forEach(function (f) {
      hacerArrastrable(f, {
        alSoltar: function (ficha, destino) { if (destino === hueco || (destino && hueco.contains(destino))) colocar(ficha); },
        alTocar: function (ficha) { colocar(ficha); },
        alMover: function (ficha, x, y) { var s = document.elementFromPoint(x, y); hueco.classList.toggle("destino", s === hueco); },
      });
    });
    hueco.addEventListener("click", function () {
      if (!colocada) return;
      colocada.classList.remove("usada");
      colocada = null;
      hueco.textContent = "…";
      hueco.classList.add("vacio");
      comprobar.disabled = true;
    });

    var comprobar = el("button", "btn", "Comprobar");
    comprobar.type = "button";
    comprobar.disabled = true;
    comprobar.addEventListener("click", function () {
      var bien = colocada && normalizar(colocada.textContent) === normalizar(item.respuesta);
      hueco.classList.add(bien ? "bien" : "mal");
      if (!bien) { hueco.textContent = item.respuesta; hueco.classList.add("corregido"); }
      fichas.forEach(function (f) { f.disabled = true; });
      comprobar.disabled = true;
      alResolver(!!bien, colocada ? colocada.textContent : "");
    });
    caja.appendChild(frase);
    caja.appendChild(el("p", "ayuda-item", item.es));
    caja.appendChild(banco);
    caja.appendChild(comprobar);
  }

  function montarEmpareja(item, caja, alResolver) {
    var cols = el("div", "parejas");
    var izq = el("div", "col izq"), der = el("div", "col der");
    var seleccion = null, hechas = 0, fallos = 0;
    var tarjetasDer = {};
    item.derecha.forEach(function (es) {
      var t = el("button", "tarjeta es", es);
      t.type = "button";
      tarjetasDer[es] = t;
      t.addEventListener("click", function () { if (seleccion) intentar(seleccion, t); });
      der.appendChild(t);
    });
    function intentar(fNo, tEs) {
      var par = item.pares.filter(function (p) { return p.no === fNo.textContent; })[0];
      var bien = par && par.es === tEs.textContent;
      if (bien) {
        fNo.classList.add("bien"); tEs.classList.add("bien");
        fNo.disabled = true; tEs.disabled = true;
        fNo.classList.remove("seleccionada");
        seleccion = null;
        hechas++;
        vibrar(12);
        if (hechas === item.pares.length) alResolver(fallos === 0, fallos + " fallos");
      } else {
        fallos++;
        fNo.classList.add("mal"); tEs.classList.add("mal");
        setTimeout(function () { fNo.classList.remove("mal"); tEs.classList.remove("mal"); }, 450);
      }
    }
    item.pares.forEach(function (p) {
      var f = botonFicha(p.no);
      f.className = "tarjeta no";
      hacerArrastrable(f, {
        alSoltar: function (ficha, destino) {
          var t = destino && destino.closest ? destino.closest(".tarjeta.es") : null;
          if (t && !t.disabled) intentar(ficha, t);
        },
        alTocar: function (ficha) {
          if (seleccion === ficha) { ficha.classList.remove("seleccionada"); seleccion = null; return; }
          if (seleccion) seleccion.classList.remove("seleccionada");
          seleccion = ficha; ficha.classList.add("seleccionada");
        },
        alMover: function (ficha, x, y) {
          var s = document.elementFromPoint(x, y); var t = s && s.closest ? s.closest(".tarjeta.es") : null;
          Array.prototype.forEach.call(der.children, function (c) { c.classList.toggle("destino", c === t); });
        },
      });
      izq.appendChild(f);
    });
    cols.appendChild(izq); cols.appendChild(der);
    caja.appendChild(el("p", "ayuda-item", "Arrastra cada frase noruega hasta su significado, o toca una y después la otra."));
    caja.appendChild(cols);
  }

  function montarMc(item, caja, alResolver) {
    if (item.contexto) {
      var ctx = el("div", "contexto-mc");
      ctx.appendChild(el("p", "eti", item.contexto.titulo.replace(/\.$/, "")));
      var pre = el("p", "texto-ctx", item.contexto.texto);
      pre.lang = "nb";
      ctx.appendChild(pre);
      caja.appendChild(ctx);
    }
    caja.appendChild(el("p", "pregunta-mc", item.pregunta));
    var lista = el("div", "opciones-mc");
    var resuelto = false;
    item.opciones.forEach(function (op, i) {
      var b = el("button", "opcion-mc");
      b.type = "button";
      b.appendChild(el("span", "letra", "abcd".charAt(i)));
      var t = el("span", "texto", op);
      if (/[æøå]/i.test(op) || /^«/.test(op)) t.lang = "nb";
      b.appendChild(t);
      b.addEventListener("click", function () {
        if (resuelto) return;
        resuelto = true;
        var bien = i === item.correcta;
        Array.prototype.forEach.call(lista.children, function (c, k) {
          c.disabled = true;
          if (k === item.correcta) c.classList.add("bien");
          else if (k === i) c.classList.add("mal");
        });
        alResolver(bien, op);
      });
      lista.appendChild(b);
    });
    caja.appendChild(lista);
  }

  function montarEscribe(item, caja, alResolver) {
    caja.appendChild(el("p", "enunciado-escribe", item.enunciado));
    var campo = el("input", "campo-escribe");
    campo.type = "text";
    campo.lang = "nb";
    campo.autocomplete = "off";
    campo.autocapitalize = "sentences";
    campo.spellcheck = false;
    campo.placeholder = "Escribe la frase en noruego";
    campo.setAttribute("aria-label", "Tu frase en noruego");
    caja.appendChild(campo);
    var fila = el("div", "fila-acciones");
    var comprobar = el("button", "btn", "Comprobar");
    comprobar.type = "button";
    var pista = el("button", "btn ghost", "Dame las palabras");
    pista.type = "button";
    fila.appendChild(comprobar); fila.appendChild(pista);
    caja.appendChild(fila);
    var zonaOrdena = null;
    pista.addEventListener("click", function () {
      if (zonaOrdena) return;
      zonaOrdena = el("div", "zona-ordena");
      caja.insertBefore(zonaOrdena, fila);
      campo.disabled = true;
      comprobar.disabled = true;
      pista.disabled = true;
      montarOrdena(item, zonaOrdena, function (bien, dado) { alResolver(bien, dado, true); });
    });
    function evaluar() {
      var dado = normalizar(campo.value), sol = normalizar(item.respuesta);
      if (!dado) { campo.focus(); return; }
      var bien = dado === sol || (sol.length > 20 && distancia(dado, sol) <= 2);
      campo.classList.add(bien ? "bien" : "mal");
      campo.disabled = true; comprobar.disabled = true; pista.disabled = true;
      alResolver(bien, campo.value);
    }
    comprobar.addEventListener("click", evaluar);
    campo.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); evaluar(); } });
  }

  var TITULOS = {
    mc: "Elige la respuesta",
    ordena: "Ordena la frase",
    transforma: "Transforma la frase",
    completa: "Completa el hueco",
    empareja: "Empareja",
    escribe: "Escríbela tú",
  };

  function montarItem(item, indice, total, alResolver) {
    var tarjeta = el("section", "ejercicio tipo-" + item.tipo);
    var cab = el("div", "ejercicio-cab");
    cab.appendChild(el("span", "eti", (indice + 1) + " de " + total + " · " + TITULOS[item.tipo]));
    tarjeta.appendChild(cab);
    var caja = el("div", "ejercicio-cuerpo");
    if (item.tipo === "ordena") {
      if (item.pista) {
        caja.appendChild(el("p", "consigna", item.parcial ? "Construye el arranque noruego que significa:" : "Construye la frase noruega que significa:"));
        caja.appendChild(el("p", "pista-es", item.pista + (item.parcial ? "…" : "")));
      } else {
        caja.appendChild(el("p", "consigna", "Ordena las palabras hasta que la frase esté bien construida."));
      }
      montarOrdena(item, caja, alResolver);
    } else if (item.tipo === "transforma") {
      var origen = el("div", "origen");
      origen.appendChild(el("span", "eti", item.etqEntrada || "Frase"));
      var pe = el("p", "frase-origen", item.entrada); pe.lang = "nb"; origen.appendChild(pe);
      if (item.instruccion) origen.appendChild(el("p", "instruccion", item.instruccion));
      caja.appendChild(origen);
      caja.appendChild(el("p", "consigna", (item.etqSalida || "Resuelto") + ". Ordena las palabras:"));
      montarOrdena(item, caja, alResolver);
    } else if (item.tipo === "completa") {
      caja.appendChild(el("p", "consigna", "Arrastra la palabra que falta al hueco, o tócala."));
      montarCompleta(item, caja, alResolver);
    } else if (item.tipo === "empareja") {
      montarEmpareja(item, caja, alResolver);
    } else if (item.tipo === "mc") {
      montarMc(item, caja, alResolver);
    } else if (item.tipo === "escribe") {
      montarEscribe(item, caja, alResolver);
    }
    tarjeta.appendChild(caja);
    return tarjeta;
  }

  function textoFeedback(item, bien) {
    if (item.tipo === "mc") return item.explicacion || "";
    if (item.tipo === "transforma") return item.motivo || "";
    if (item.tipo === "escribe") return item.explicacion || "";
    if (item.tipo === "completa") return bien ? "" : "La palabra era «" + item.respuesta + "». " + item.es;
    if (item.tipo === "ordena") return item.motivo || (bien ? "" : item.pista);
    return "";
  }

  function fraseSolucion(item) {
    if (item.tipo === "ordena" || item.tipo === "transforma" || item.tipo === "escribe") return item.frase || item.respuesta || item.solucion.join(" ");
    if (item.tipo === "completa") return item.frase;
    return "";
  }

  // Monta la práctica completa de una pieza dentro de un contenedor.
  // opciones: { estado, guardar, alTerminar }
  function montar(pieza, opciones) {
    var estado = opciones.estado;
    if (!estado.practica) estado.practica = {};
    var registro = estado.practica[pieza.codigo] || { tandas: 0, mejor: null, ultimo: null, falladas: [] };
    var semilla = registro.tandas || 0;
    var generado = generar(pieza, semilla);
    if (!generado.items.length) return null;

    var raiz = el("section", "practica-pieza");
    raiz.id = "practica";
    var cab = el("div", "practica-cab");
    cab.appendChild(el("p", "kicker", "Ponlo a prueba"));
    cab.appendChild(el("h2", null, "Practica " + pieza.codigo + " sin salir de aquí"));
    cab.appendChild(el("p", "practica-intro", "Ocho ejercicios cortos hechos con las frases de esta pieza: elegir, ordenar arrastrando, completar, emparejar y escribir. Cada uno te dice al momento cómo ha ido y por qué."));
    if (registro.mejor) cab.appendChild(el("p", "practica-mejor", "Tu mejor tanda: " + registro.mejor.aciertos + " de " + registro.mejor.total + "."));
    raiz.appendChild(cab);

    var barra = el("div", "practica-barra");
    var puntos = [];
    generado.items.forEach(function () { var p = el("i"); puntos.push(p); barra.appendChild(p); });
    raiz.appendChild(barra);

    var escenario = el("div", "practica-escenario");
    raiz.appendChild(escenario);

    var indice = 0, aciertos = 0, resultados = [];
    var soloFalladas = opciones.soloFalladas || null;
    var items = soloFalladas ? generado.items.filter(function (it) { return soloFalladas.indexOf(it.id) >= 0; }) : generado.items;
    if (!items.length) items = generado.items;
    puntos.forEach(function (p, i) { p.hidden = i >= items.length; });

    function mostrar() {
      escenario.innerHTML = "";
      if (indice >= items.length) return resumen();
      var item = items[indice];
      puntos.forEach(function (p, i) { p.className = i < indice ? (resultados[i] ? "ok" : "ko") : (i === indice ? "actual" : ""); });
      var tarjeta = montarItem(item, indice, items.length, function (bien, dado, conPista) {
        var acierto = bien && !conPista;
        resultados[indice] = acierto;
        if (acierto) aciertos++;
        vibrar(acierto ? 10 : [30, 40, 30]);
        var fb = el("div", "feedback " + (acierto ? "bien" : "mal"));
        fb.setAttribute("role", "status");
        var titulo = acierto ? "Bien." : (bien && conPista ? "Con ayuda, pero bien." : "No es esa.");
        fb.appendChild(el("b", null, titulo));
        var sol = fraseSolucion(item);
        if (sol && !acierto) { var ps = el("p", "solucion", sol); ps.lang = "nb"; fb.appendChild(ps); }
        var txt = textoFeedback(item, acierto);
        if (txt) fb.appendChild(el("p", null, txt));
        var sig = el("button", "btn", indice === items.length - 1 ? "Ver el resultado" : "Siguiente");
        sig.type = "button";
        sig.addEventListener("click", function () { indice++; mostrar(); });
        fb.appendChild(sig);
        tarjeta.appendChild(fb);
        fb.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setTimeout(function () { sig.focus(); }, 50);
      });
      escenario.appendChild(tarjeta);
      if (indice > 0) tarjeta.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function resumen() {
      var total = items.length;
      var falladas = items.filter(function (it, i) { return !resultados[i]; }).map(function (it) { return it.id; });
      registro.tandas = (registro.tandas || 0) + 1;
      registro.ultimo = { aciertos: aciertos, total: total, fecha: new Date().toISOString() };
      if (!registro.mejor || aciertos / total > registro.mejor.aciertos / registro.mejor.total) registro.mejor = { aciertos: aciertos, total: total };
      registro.falladas = falladas;
      estado.practica[pieza.codigo] = registro;
      opciones.guardar();

      var caja = el("section", "resumen-practica " + (aciertos === total ? "pleno" : aciertos >= total * 0.6 ? "bien" : "flojo"));
      caja.appendChild(el("p", "eti", "Resultado"));
      caja.appendChild(el("p", "marcador", aciertos + " de " + total));
      var frase = aciertos === total
        ? "Todo bien. La próxima tanda trae otras frases de la misma pieza."
        : aciertos >= total * 0.6
          ? "Va saliendo. Repite las que han fallado antes de pasar a otra pieza."
          : "Todavía no está asentado. Vuelve al mecanismo, lee el contraste y repite las falladas.";
      caja.appendChild(el("p", "lectura", frase));
      var acciones = el("div", "fila-acciones");
      if (falladas.length) {
        var rep = el("button", "btn", "Repetir las falladas (" + falladas.length + ")");
        rep.type = "button";
        rep.addEventListener("click", function () {
          var nuevo = montar(pieza, Object.assign({}, opciones, { soloFalladas: falladas, semillaFija: semilla }));
          raiz.replaceWith(nuevo);
          nuevo.scrollIntoView({ block: "start", behavior: "smooth" });
        });
        acciones.appendChild(rep);
      }
      var otra = el("button", "btn" + (falladas.length ? " ghost" : ""), "Otra tanda con frases nuevas");
      otra.type = "button";
      otra.addEventListener("click", function () {
        var nuevo = montar(pieza, Object.assign({}, opciones, { soloFalladas: null }));
        raiz.replaceWith(nuevo);
        nuevo.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      acciones.appendChild(otra);
      caja.appendChild(acciones);
      if (opciones.alTerminar) opciones.alTerminar(registro);
      escenario.appendChild(caja);
      puntos.forEach(function (p, i) { p.className = resultados[i] ? "ok" : "ko"; });
      caja.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    if (opciones.semillaFija !== undefined) { /* la repetición de falladas conserva la tanda */ }
    mostrar();
    return raiz;
  }

  // Tarjeta de llamada para la cabecera de la pieza.
  function llamada(pieza, estado) {
    var registro = estado.practica && estado.practica[pieza.codigo];
    var caja = el("a", "practica-llamada");
    caja.href = "#practica";
    caja.appendChild(el("span", "eti", "Ponlo a prueba"));
    var txt = el("span", "txt");
    txt.appendChild(el("strong", null, registro && registro.mejor ? "Practicar otra vez" : "Ocho ejercicios interactivos"));
    txt.appendChild(el("small", null, registro && registro.mejor
      ? "Tu mejor tanda: " + registro.mejor.aciertos + " de " + registro.mejor.total + ". Arrastra, elige, completa y escribe."
      : "Al final de la pieza: arrastra, elige, completa y escribe con las frases de este mecanismo."));
    caja.appendChild(txt);
    caja.appendChild(el("span", "flecha", "↓"));
    caja.addEventListener("click", function (e) {
      var destino = document.getElementById("practica");
      if (destino) { e.preventDefault(); destino.scrollIntoView({ block: "start", behavior: "smooth" }); }
    });
    return caja;
  }

  root.NexoPractica = Object.freeze({ extraer: extraer, generar: generar, montar: montar, llamada: llamada, TANDA: TANDA });
})(typeof window !== "undefined" ? window : globalThis);

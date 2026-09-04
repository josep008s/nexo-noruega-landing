// Práctica interactiva del curso B1 de NEXO NORSK.
//
// Construye un banco grande de ejercicios por pieza a partir del contenido ya
// revisado (nunca inventa noruego): los bloques para llevarte, la ficha T (modelo),
// la ficha P y la ficha E con sus soluciones, las frases de ejemplo de la propia
// pieza y, con el curso completo, las expresiones del anexo de ese mecanismo.
// Tipos: elegir la respuesta o la correcta, ordenar palabras arrastrando, completar
// el hueco, emparejar, transformar una frase y escribirla. Todo ocurre en el
// navegador; el progreso guarda ids, aciertos y tandas, nunca las respuestas.
(function (root) {
  "use strict";

  var TANDA = 8;
  var MAX_VISTOS = 800;

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

  function limpiarToken(t) { return String(t || "").toLowerCase().replace(/^[«"(]+/, "").replace(/[»".,!?;:)]+$/, ""); }

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
  function idDe(tipo, clave) { return tipo + ":" + semillaDe(clave).toString(36); }

  // ---------- Extracción del contenido de la pieza ----------

  function seccion(pieza, id) {
    var s = (pieza.secciones || []).filter(function (x) { return x.id === id; })[0];
    return s ? String(s.html || "") : "";
  }

  function bloqueDeFicha(html, letra) {
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

  function nombresPropios(pieza, anexoHtml) {
    var set = {};
    var fuentes = (pieza.secciones || []).map(function (s) { return s.html; });
    if (anexoHtml) fuentes.push(anexoHtml);
    fuentes.forEach(function (html) {
      var textos = codigos(html);
      String(html || "").replace(/(?:^|<br\s*\/?>)\s*NO:\s*([^<]+)/g, function (m, t) { textos.push(decodificar(t)); return m; });
      textos.forEach(function (c) {
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

  function fraseValida(frase, min, max) {
    var n = tokens(frase).length;
    return n >= (min || 3) && n <= (max || 14);
  }

  function extraerBloques(pieza) {
    var html = seccion(pieza, "bloques-para-llevarte");
    var pares = [];
    filas(html).forEach(function (celdas) {
      if (celdas.length < 2) return;
      var iNo = -1;
      for (var i = 0; i < celdas.length; i++) { if (/<code>/.test(celdas[i])) { iNo = i; break; } }
      if (iNo < 0 || iNo + 1 >= celdas.length) return;
      if (/herramienta/i.test(plano(celdas[0]))) return;
      var cs = codigos(celdas[iNo]);
      if (cs.length !== 1 || / y <code>/.test(celdas[iNo])) return;
      var parcial = /(?:\.\.\.|…)\s*$/.test(cs[0]);
      var no = sinPuntosSuspensivos(cs[0]);
      if (/<code>/.test(celdas[iNo + 1])) return;
      var es = sinPuntosSuspensivos(plano(celdas[iNo + 1]));
      if (!fraseValida(no) || !es || es.length > 140) return;
      pares.push({ no: no, es: es, parcial: parcial });
    });
    return pares;
  }

  function extraerFichaT(pieza) {
    var bloque = bloqueDeFicha(seccion(pieza, "practica"), "T");
    var out = [];
    var tabla = /<table>[\s\S]*?<\/table>/i.exec(bloque);
    if (tabla) {
      var fs = filas(tabla[0]);
      var cab = fs.length ? fs[0].map(plano) : [];
      fs.slice(1).forEach(function (celdas) {
        if (cab.length >= 4 && celdas.length >= 4) {
          var ent = codigos(celdas[1]), sal = codigos(celdas[2]);
          if (ent.length === 1 && sal.length === 1 && fraseValida(sal[0])) out.push({ entrada: ent[0], salida: sal[0], motivo: planoConCodigo(celdas[3]), etqEntrada: cab[1], etqSalida: cab[2] });
        } else if (cab.length === 3 && celdas.length >= 3) {
          var cs = codigos(celdas[1]);
          if (cs.length === 1 && fraseValida(cs[0])) out.push({ salida: cs[0], motivo: planoConCodigo(celdas[2]) });
        }
      });
      if (out.length) return out;
    }
    var re = /<p><strong>T\d+[^<]*<\/strong>([\s\S]*?)<\/p>/gi, m;
    while ((m = re.exec(bloque))) {
      var cuerpo = m[1];
      var base = /Base:\s*<code>([\s\S]*?)<\/code>([\s\S]*?)<br\s*\/?>\s*Resuelto:\s*<code>([\s\S]*?)<\/code>([\s\S]*?)(?:<br\s*\/?>\s*Motivo:\s*([\s\S]*))?$/i.exec(cuerpo);
      if (base) {
        if (fraseValida(base[3])) out.push({ entrada: decodificar(base[1]).trim(), instruccion: plano(base[2]), salida: decodificar(base[3]).trim(), motivo: planoConCodigo(base[5] || ""), etqEntrada: "Base", etqSalida: "Resuelto" });
        continue;
      }
      var corrige = /Lo que sale solo:\s*<code>([\s\S]*?)<\/code>[\s\S]*?Lo que resuelve:\s*<code>([\s\S]*?)<\/code>([\s\S]*)$/i.exec(cuerpo);
      if (corrige) {
        var quiere = /Quieres decir:\s*([\s\S]*?)<br/i.exec(cuerpo);
        var porque = /Por qué:\s*([\s\S]*?)(?:<br\s*\/?>\s*Por qué no la otra|$)/i.exec(corrige[3]);
        if (fraseValida(corrige[2])) out.push({ entrada: decodificar(corrige[1]).trim(), entradaMal: true, instruccion: quiere ? "Quieres decir: " + plano(quiere[1]) : "", salida: decodificar(corrige[2]).trim(), motivo: porque ? planoConCodigo(porque[1]) : planoConCodigo(corrige[3]), etqEntrada: "Lo que sale solo", etqSalida: "Lo que resuelve" });
        continue;
      }
      var primero = /<code>([\s\S]*?)<\/code>/.exec(cuerpo);
      if (!primero || !fraseValida(primero[1])) continue;
      var antes = plano(cuerpo.slice(0, primero.index)).replace(/^[\s·.:-]+/, "");
      var despues = planoConCodigo(cuerpo.slice(primero.index + primero[0].length)).replace(/^\s*\(B1-P[^)]*\)\s*/, "").replace(/^[\s·.:-]+/, "");
      out.push({ salida: decodificar(primero[1]).trim(), pista: antes.length >= 12 && !/^Pieza|^Criterio/i.test(antes) ? antes : "", motivo: despues });
    }
    return out;
  }

  function itemsNumerados(bloque, letra, exigeCodigo) {
    var out = [], m;
    var reLi = /<li>([\s\S]*?)<\/li>/gi;
    while ((m = reLi.exec(bloque))) {
      var li = m[1];
      var num = new RegExp("^\\s*<strong>" + letra + "(\\d+)\\.<\\/strong>\\s*").exec(li);
      var cuerpo = num ? li.slice(num[0].length) : li;
      if (exigeCodigo && !/^\s*<code>/.test(cuerpo)) continue;
      out.push({ n: num ? Number(num[1]) : null, html: cuerpo });
    }
    if (out.length) {
      var contador = 0;
      out.forEach(function (it) { if (!it.n) it.n = ++contador; });
      return out;
    }
    var reP = new RegExp("<strong>" + letra + "(\\d+)\\.?(?:\\s[^<]*)?<\\/strong>\\s*([\\s\\S]*?)(?=<br\\s*\\/?>\\s*<strong>" + letra + "\\d+|<\\/p>)", "gi");
    while ((m = reP.exec(bloque))) {
      if (exigeCodigo && !/^\s*<code>/.test(m[2])) continue;
      out.push({ n: Number(m[1]), html: m[2] });
    }
    return out;
  }

  // Ficha P (y ficha E de producción): enunciado en castellano + frase resuelta en la solución.
  function extraerResueltos(pieza, letra) {
    var pr = bloqueDeFicha(seccion(pieza, "practica"), letra);
    var so = bloqueDeFicha(seccion(pieza, "soluciones"), letra);
    var out = [];
    if (!pr || !so) return out;
    var enunciados = itemsNumerados(pr, letra, false);
    var soluciones = itemsNumerados(so, letra, true);
    if (!enunciados.length || !soluciones.length) return out;
    var porNumero = {};
    enunciados.forEach(function (e, i) { porNumero[e.n || (i + 1)] = e; });
    soluciones.forEach(function (sol, i) {
      var en = porNumero[sol.n || (i + 1)];
      if (!en) return;
      var mm = /^\s*<code>([\s\S]*?)<\/code>([\s\S]*)$/.exec(sol.html);
      if (!mm || /respuesta libre|modelo posible|respuesta posible/i.test(plano(sol.html))) return;
      var resp = decodificar(mm[1]).trim();
      if (!fraseValida(resp, 3, 16) || /\.\.\.|…/.test(resp)) return;
      var enunciado = planoConCodigo(en.html).replace(/^[\s·.:-]+/, "");
      if (enunciado.length < 12 || enunciado.length > 260) return;
      out.push({ n: sol.n || (i + 1), enunciado: enunciado, respuesta: resp, explicacion: planoConCodigo(mm[2]) });
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

  // Frases de ejemplo de las secciones explicativas. Solo frases completas y sin
  // marca de "esto no vale" delante: la escena y la grieta quedan fuera porque
  // enseñan la forma que falla.
  var NEGATIVO = /(no vale|y no\b|no es\b|en vez de|en lugar de|nunca|falla|\bmal\b|sale solo|calco|error|incorrect|tampoco|suena raro|no:)\s*(?:<[^>]+>|[^<]){0,25}$/i;
  function extraerEjemplos(pieza, excluir) {
    var out = [], vistos = {};
    excluir.forEach(function (f) { vistos[normalizar(f)] = true; });
    ["el-mecanismo", "en-el-examen", "en-tu-vida"].forEach(function (id) {
      var html = seccion(pieza, id), m;
      var re = /<code>([\s\S]*?)<\/code>/g;
      while ((m = re.exec(html))) {
        var f = decodificar(m[1]).trim();
        if (!fraseValida(f, 4, 14) || !/^[A-ZÆØÅ]/.test(f) || !/[.!?]$/.test(f) || /\.\.\.|…/.test(f)) continue;
        var antes = html.slice(Math.max(0, m.index - 70), m.index);
        if (NEGATIVO.test(antes)) continue;
        var k = normalizar(f);
        if (vistos[k]) continue;
        vistos[k] = true;
        out.push({ no: f });
      }
    });
    return out;
  }

  // Anexo de expresiones: <p><strong>expresión</strong> · tipo · nivel · significado<br>...<br>NO: frase<br>ES: traducción<br>MATIZ: nota</p>
  function extraerExpresiones(anexoHtml) {
    var out = [], m;
    var re = /<p><strong>([^<]+)<\/strong>([\s\S]*?)<\/p>/g;
    while ((m = re.exec(String(anexoHtml || "")))) {
      var expresion = decodificar(m[1]).trim();
      var cuerpo = m[2];
      var cab = /^\s*·\s*[A-Z]{2}\s*·\s*[AB][12]\s*·\s*([^<]+)/.exec(cuerpo);
      var no = /(?:^|<br\s*\/?>)\s*NO:\s*([^<]+)/.exec(cuerpo);
      var es = /(?:^|<br\s*\/?>)\s*ES:\s*([^<]+)/.exec(cuerpo);
      var matiz = /(?:^|<br\s*\/?>)\s*MATIZ:\s*([^<]+)/.exec(cuerpo);
      if (!cab || !no || !es) continue;
      var frase = decodificar(no[1]).trim();
      if (!fraseValida(frase, 4, 16)) continue;
      out.push({ expresion: expresion, significado: decodificar(cab[1]).trim().replace(/[.;]\s*$/, ""), no: frase, es: decodificar(es[1]).trim(), matiz: matiz ? decodificar(matiz[1]).trim() : "" });
    }
    return out;
  }

  function seccionAnexo(anexoPieza, codigoMecanismo) {
    if (!anexoPieza || !codigoMecanismo) return null;
    var pref = String(codigoMecanismo).toLowerCase() + "-";
    var s = (anexoPieza.secciones || []).filter(function (x) { return String(x.id || "").indexOf(pref) === 0; })[0];
    return s ? String(s.html || "") : null;
  }

  function extraer(pieza, anexoHtml) {
    var bloques = extraerBloques(pieza);
    var fichaT = extraerFichaT(pieza);
    var fichaP = extraerResueltos(pieza, "P");
    var fichaEprod = extraerResueltos(pieza, "E");
    var conocidas = bloques.map(function (b) { return b.no; }).concat(fichaT.map(function (t) { return t.salida; }), fichaP.map(function (p) { return p.respuesta; }), fichaEprod.map(function (p) { return p.respuesta; }));
    return {
      propios: nombresPropios(pieza, anexoHtml),
      bloques: bloques,
      fichaT: fichaT,
      fichaP: fichaP,
      fichaEprod: fichaEprod,
      fichaE: extraerFichaE(pieza),
      ejemplos: extraerEjemplos(pieza, conocidas),
      expresiones: extraerExpresiones(anexoHtml),
    };
  }

  // ---------- Construcción del banco ----------

  var FUNCIONALES = ["at", "om", "som", "fordi", "hvis", "når", "da", "derfor", "ikke", "men", "og", "eller", "for", "så", "mens", "etter", "før", "siden", "sin", "si", "sitt", "sine", "hans", "hennes", "deres", "det", "den", "de", "må", "kan", "skal", "vil", "bør", "kunne", "måtte", "skulle", "ville", "har", "hadde", "er", "var", "blir", "ble", "alltid", "bare", "ofte", "aldri", "også", "ennå", "nok", "vel", "jo", "kanskje", "ganske", "litt", "veldig", "mye", "mange", "noen", "ingen", "ingenting", "alle", "hver", "flere", "både", "enten", "verken", "likevel", "dessuten", "altså", "selv", "egentlig", "fortsatt", "til", "på", "i", "med", "av", "fra", "hos", "over", "under"];
  var FUNC = {};
  FUNCIONALES.forEach(function (f) { FUNC[f] = true; });

  function primerToken(t, propios) {
    var limpio = t.replace(/[.,!?;:]+$/, "");
    if (propios[limpio] || /^[A-ZÆØÅ]{2,}$/.test(limpio)) return t;
    return t.charAt(0).toLowerCase() + t.slice(1);
  }

  function fichasOrdena(frase, propios) {
    return tokens(frase).map(function (t, i) { return i === 0 ? primerToken(t, propios) : t; });
  }

  function mezclaDistinta(sol, rnd) {
    var mezcla = barajar(sol, rnd), intentos = 0;
    while (mezcla.join(" ") === sol.join(" ") && intentos++ < 6) mezcla = barajar(sol, rnd);
    return mezcla;
  }

  function itemOrdena(frase, extra, propios, rnd, fuente) {
    var sol = fichasOrdena(frase, propios);
    if (sol.length < 3) return null;
    return Object.assign({ tipo: "ordena", id: idDe("ordena", fuente + "|" + frase), fuente: fuente, fichas: mezclaDistinta(sol, rnd), solucion: sol, frase: frase, pista: "", motivo: "", parcial: false }, extra || {});
  }

  function itemTransforma(t, propios, rnd) {
    var sol = fichasOrdena(t.salida, propios);
    return { tipo: "transforma", id: idDe("transforma", t.salida), fuente: "fichas", entrada: t.entrada, entradaMal: !!t.entradaMal, instruccion: t.instruccion || "", etqEntrada: t.etqEntrada, etqSalida: t.etqSalida, fichas: mezclaDistinta(sol, rnd), solucion: sol, frase: t.salida, motivo: t.motivo || "" };
  }

  // Huecos: primero palabras de función (lo que enseña el mecanismo), después contenido.
  function posicionesHueco(ts, rnd, maximo, preferidas) {
    var pref = [], fun = [], cont = [];
    ts.forEach(function (t, i) {
      var l = limpiarToken(t);
      if (!l || /\d/.test(l)) return;
      if (preferidas && preferidas[l]) { pref.push(i); return; }
      if (FUNC[l] && i > 0) fun.push(i);
      else if (l.length >= 4 && i > 0 && i < ts.length - 1) cont.push(i);
    });
    // Las palabras de la expresión van primero; después las de función y, al final, el contenido.
    var orden = barajar(pref, rnd).concat(barajar(fun, rnd), barajar(cont, rnd));
    var out = [], usados = {};
    orden.forEach(function (i) { var l = limpiarToken(ts[i]); if (!usados[l] && out.length < maximo) { usados[l] = true; out.push(i); } });
    return out;
  }

  function itemCompleta(frase, idx, es, poolContenido, rnd, fuente, extra) {
    var ts = tokens(frase);
    var respuesta = ts[idx].replace(/[.,!?;:]+$/, "");
    var puntuacion = ts[idx].slice(respuesta.length);
    var l = respuesta.toLowerCase();
    var pool = {};
    if (FUNC[l]) FUNCIONALES.forEach(function (f) { if (f.indexOf(" ") < 0 && f.length > 1) pool[f] = true; });
    else {
      (poolContenido || []).forEach(function (w) { if (w !== l && w.length >= 3) pool[w] = true; });
      if (Object.keys(pool).length < 3) FUNCIONALES.forEach(function (f) { pool[f] = true; });
    }
    delete pool[l];
    var distractores = elegirN(Object.keys(pool), 3, rnd);
    if (distractores.length < 2) return null;
    return Object.assign({ tipo: "completa", id: idDe("completa", fuente + "|" + frase + "|" + idx), fuente: fuente, antes: ts.slice(0, idx), despues: ts.slice(idx + 1), puntuacion: puntuacion, respuesta: respuesta, opciones: barajar([respuesta].concat(distractores), rnd), es: es || "", frase: frase, motivo: "" }, extra || {});
  }

  function itemsEmpareja(pares, rnd, fuente, clave) {
    var out = [];
    var mezclados = barajar(pares, rnd);
    for (var i = 0; i + 3 <= mezclados.length; i += 4) {
      var sel = mezclados.slice(i, i + 4);
      if (sel.length < 3) break;
      out.push({ tipo: "empareja", id: idDe("empareja", clave + "|" + sel.map(function (p) { return p.no; }).join("|")), fuente: fuente, pares: sel, derecha: barajar(sel.map(function (p) { return p.es; }), rnd) });
    }
    return out;
  }

  function itemEscribe(p, propios, rnd, fuente) {
    var sol = fichasOrdena(p.respuesta, propios);
    return { tipo: "escribe", id: idDe("escribe", p.respuesta), fuente: fuente, enunciado: p.enunciado, respuesta: p.respuesta, explicacion: p.explicacion || "", fichas: mezclaDistinta(sol, rnd), solucion: sol };
  }

  function itemMc(e) {
    return { tipo: "mc", id: idDe("mc", e.pregunta + "|" + e.opciones.join("|")), fuente: "fichas", pregunta: e.pregunta, opciones: e.opciones, correcta: e.correcta, explicacion: e.explicacion, contexto: e.contexto, opcionesNb: e.opciones.some(function (o) { return /^«/.test(o); }) };
  }

  // Elegir la correcta: pregunta con cuatro opciones del mismo conjunto.
  function itemElige(pregunta, correcta, otras, explicacion, rnd, fuente, opcionesNb, clave) {
    var distintas = [];
    otras.forEach(function (o) { if (o && o !== correcta && distintas.indexOf(o) < 0) distintas.push(o); });
    var distractores = elegirN(distintas, 3, rnd);
    if (distractores.length < 2) return null;
    var opciones = barajar([correcta].concat(distractores), rnd);
    return { tipo: "elige", id: idDe("elige", clave), fuente: fuente, pregunta: pregunta, opciones: opciones, correcta: opciones.indexOf(correcta), explicacion: explicacion || "", opcionesNb: !!opcionesNb };
  }

  function palabrasClaveExpresion(expr) {
    return tokens(expr).map(limpiarToken).filter(function (w) { return w && w !== "å" && w !== "seg" && w.length >= 2; });
  }

  var bancos = {};

  function banco(pieza, anexoHtml) {
    var clave = pieza.codigo + (anexoHtml ? "+anexo" : "");
    if (bancos[clave]) return bancos[clave];
    var d = extraer(pieza, anexoHtml);
    var rnd = prng(semillaDe("banco:" + pieza.codigo));
    var items = [];
    var contenido = [];
    d.bloques.concat(d.ejemplos).forEach(function (p) { tokens(p.no).forEach(function (t) { var l = limpiarToken(t); if (l.length >= 3 && !FUNC[l] && !/\d/.test(l) && !/^[A-ZÆØÅ]/.test(t)) contenido.push(l); }); });

    // Bloques para llevarte
    d.bloques.forEach(function (p) {
      items.push(itemOrdena(p.no, { pista: p.es, parcial: p.parcial }, d.propios, rnd, "bloques"));
      posicionesHueco(tokens(p.no), rnd, 2).forEach(function (idx) { items.push(itemCompleta(p.no, idx, p.es, contenido, rnd, "bloques")); });
      items.push(itemElige("¿Qué significa «" + p.no + (p.parcial ? "…" : "") + "»?", p.es, d.bloques.map(function (x) { return x.es; }), "«" + p.no + "» significa: " + p.es + ".", rnd, "bloques", false, "sig|" + p.no));
      items.push(itemElige("¿Cómo se dice «" + p.es + (p.parcial ? "…" : "") + "»?", p.no, d.bloques.map(function (x) { return x.no; }), "«" + p.no + "» significa: " + p.es + ".", rnd, "bloques", true, "fra|" + p.no));
    });
    items = items.concat(itemsEmpareja(d.bloques, rnd, "bloques", "bloques"));

    // Ficha T
    d.fichaT.forEach(function (t) {
      if (t.entrada) items.push(itemTransforma(t, d.propios, rnd));
      else items.push(itemOrdena(t.salida, { pista: t.pista || "", motivo: t.motivo || "" }, d.propios, rnd, "fichas"));
      posicionesHueco(tokens(t.salida), rnd, 1).forEach(function (idx) { items.push(itemCompleta(t.salida, idx, t.pista || t.instruccion || "", contenido, rnd, "fichas", { motivo: t.motivo || "" })); });
    });

    // Ficha P y ficha E de producción
    d.fichaP.concat(d.fichaEprod).forEach(function (p) {
      items.push(itemEscribe(p, d.propios, rnd, "fichas"));
      items.push(itemOrdena(p.respuesta, { pista: p.enunciado, motivo: p.explicacion || "" }, d.propios, rnd, "fichas"));
      posicionesHueco(tokens(p.respuesta), rnd, 1).forEach(function (idx) { items.push(itemCompleta(p.respuesta, idx, p.enunciado, contenido, rnd, "fichas", { motivo: p.explicacion || "" })); });
    });

    // Ficha E de opción múltiple
    d.fichaE.forEach(function (e) { items.push(itemMc(e)); });

    // Frases de ejemplo de la pieza
    d.ejemplos.forEach(function (p) {
      items.push(itemOrdena(p.no, {}, d.propios, rnd, "pieza"));
      posicionesHueco(tokens(p.no), rnd, 1).forEach(function (idx) { items.push(itemCompleta(p.no, idx, "", contenido, rnd, "pieza")); });
    });

    // Anexo de expresiones del mecanismo
    if (d.expresiones.length) {
      var clavesExpr = {};
      d.expresiones.forEach(function (x) { palabrasClaveExpresion(x.expresion).forEach(function (w) { clavesExpr[w] = true; }); });
      var poolExpr = Object.keys(clavesExpr);
      d.expresiones.forEach(function (x) {
        var expl = "«" + x.expresion + "»: " + x.significado + "." + (x.matiz ? " " + x.matiz : "");
        items.push(itemElige("¿Qué significa «" + x.expresion + "»?", x.significado, d.expresiones.map(function (y) { return y.significado; }), expl, rnd, "anexo", false, "exsig|" + x.expresion));
        items.push(itemElige("¿Qué expresión significa «" + x.significado + "»?", x.expresion, d.expresiones.map(function (y) { return y.expresion; }), expl, rnd, "anexo", true, "exfra|" + x.expresion));
        items.push(itemOrdena(x.no, { pista: x.es, motivo: x.matiz ? "«" + x.expresion + "»: " + x.matiz : "" }, d.propios, rnd, "anexo"));
        var ts = tokens(x.no);
        var pref = {};
        palabrasClaveExpresion(x.expresion).forEach(function (w) { pref[w] = true; });
        var pos = posicionesHueco(ts, rnd, 1, pref);
        if (pos.length) {
          var l = limpiarToken(ts[pos[0]]);
          var pool = pref[l] ? poolExpr.filter(function (w) { return w !== l; }) : contenido;
          items.push(itemCompleta(x.no, pos[0], x.es, pool, rnd, "anexo", { motivo: x.matiz ? "«" + x.expresion + "»: " + x.matiz : "" }));
        }
      });
      items = items.concat(itemsEmpareja(d.expresiones.map(function (x) { return { no: x.expresion, es: x.significado }; }), rnd, "anexo", "anexo"));
    }

    items = items.filter(Boolean);
    var vistos = {}, unicos = [];
    items.forEach(function (it) { if (!vistos[it.id]) { vistos[it.id] = true; it.mecanismo = pieza.codigo; unicos.push(it); } });

    var porTipo = {}, porFuente = {};
    unicos.forEach(function (it) { porTipo[it.tipo] = (porTipo[it.tipo] || 0) + 1; porFuente[it.fuente] = (porFuente[it.fuente] || 0) + 1; });
    var resultado = {
      items: unicos,
      porTipo: porTipo,
      porFuente: porFuente,
      fuentes: { bloques: d.bloques.length, fichaT: d.fichaT.length, fichaP: d.fichaP.length, fichaEprod: d.fichaEprod.length, fichaE: d.fichaE.length, ejemplos: d.ejemplos.length, expresiones: d.expresiones.length },
    };
    bancos[clave] = resultado;
    return resultado;
  }

  var ORDEN_TIPOS = ["mc", "elige", "empareja", "ordena", "completa", "transforma", "escribe"];

  function filtrar(items, filtro) {
    if (!filtro || filtro === "todos") return items;
    if (filtro === "anexo") return items.filter(function (it) { return it.fuente === "anexo"; });
    return items.filter(function (it) { return it.tipo === filtro; });
  }

  // Una tanda: ejercicios no vistos, variados por tipo, con el filtro elegido.
  function tanda(items, opciones) {
    var n = opciones.n || TANDA;
    var vistos = opciones.vistos || {};
    var rnd = prng(semillaDe("tanda:" + (opciones.semilla || 0)));
    var candidatos = items.filter(function (it) { return !vistos[it.id]; });
    var reinicio = false;
    if (candidatos.length < Math.min(n, items.length)) { candidatos = items.slice(); reinicio = true; }
    var porTipo = {};
    barajar(candidatos, rnd).forEach(function (it) { (porTipo[it.tipo] = porTipo[it.tipo] || []).push(it); });
    var out = [];
    var tipos = ORDEN_TIPOS.filter(function (t) { return porTipo[t] && porTipo[t].length; });
    var ronda = 0;
    while (out.length < n && tipos.some(function (t) { return porTipo[t].length; })) {
      tipos.forEach(function (t) {
        if (out.length >= n || !porTipo[t].length) return;
        var ya = out.filter(function (x) { return x.tipo === t; }).length;
        if ((t === "mc" || t === "elige") && ya >= 2 && ronda < 3) return;
        if (t === "empareja" && ya >= 1 && ronda < 3) return;
        out.push(porTipo[t].shift());
      });
      ronda++;
    }
    return { items: out, reinicio: reinicio, restantes: Math.max(0, candidatos.length - out.length) };
  }

  // ---------- Diagnóstico del fallo ----------
  // La corrección no es una frase fija: compara lo que has puesto con la solución,
  // palabra a palabra, y añade la regla del mecanismo. Nunca inventa noruego.

  var REGLAS = {
    M01: "Cuando la frase no empieza por el sujeto, el verbo conjugado va en segunda posición y el sujeto justo detrás.",
    M02: "Dentro de la subordinada el orden es conjunción, sujeto, adverbio (ikke, alltid, bare) y después el verbo. La subordinada no invierte nunca.",
    M03: "La relativa va con «som» pegada al nombre que describe. Si «som» hace de sujeto de la relativa, no se puede quitar.",
    M04: "Con una fecha o un momento cerrado va preteritum. Con una duración que sigue hoy o una experiencia sin fecha va presens perfektum: «har» más participio.",
    M05: "«Da» es una vez en el pasado; «når» es cada vez o futuro. Si la subordinada temporal va delante, después de la coma viene el verbo de la principal.",
    M06: "«Fordi» abre una subordinada, con el sujeto delante del verbo. «Derfor» y «så» abren una principal y empujan el verbo a la segunda posición.",
    M07: "La condición con «hvis» delante: coma y después el verbo de la principal. En la hipótesis entran «ville» o «skulle» más infinitivo.",
    M08: "En la pasiva el objeto pasa a ser sujeto: «bli» más participio, o la forma en -s. El agente, si aparece, va con «av».",
    M09: "Afirmación: «at». Pregunta de sí o no: «om», nunca «hvis». Dentro de la subordinada no hay inversión, y el verbo retrocede al pasado si el verbo de decir está en pasado.",
    M10: "Los modales matizan: «kan» y «kanskje» posibilidad, «må» obligación, «bør» consejo, «skulle» y «ville» hipótesis. Las partículas «jo», «vel» y «nok» van detrás del verbo.",
    M11: "Para estar de acuerdo o discrepar se recoge primero lo dicho («som du sa», «jeg er enig i at») y después viene tu postura.",
    M12: "«Noen» en preguntas y afirmaciones; «ingen» o «ikke noen» en negativas. «Mange» con lo que se cuenta y «mye» con lo que no se cuenta.",
    M13: "«Sin», «si», «sitt» y «sine» solo cuando el poseedor es el sujeto de la frase. Si es otra persona, «hans», «hennes» o «deres».",
    M14: "La carta oficial condensa: participio o sustantivo en lugar de la frase entera. Al deshacerlo, sujeto, verbo y complemento vuelven a su sitio.",
    M15: "Los conectores de párrafo («likevel», «dessuten», «derfor») ocupan la primera posición y empujan el verbo a la segunda. «Det» de relleno abre frases sin sujeto real.",
    M16: "Al reparar en directo se retoma la idea con un conector («altså», «jeg mener») y se termina la frase; no se vuelve a empezar desde cero.",
  };

  var PARES = [
    [["at", "om"], "«at» introduce una afirmación o una opinión; «om» una pregunta de sí o no."],
    [["om", "hvis"], "«hvis» pone una condición; «om» cuenta una pregunta de sí o no. El «si» del castellano tienta a usar «hvis», pero aquí no es condición."],
    [["at", "hvis"], "«hvis» pone una condición; «at» introduce lo que alguien dice o piensa."],
    [["da", "når"], "«da» es una vez concreta en el pasado; «når» es cada vez o algo que todavía no ha pasado."],
    [["fordi", "derfor"], "«fordi» da la causa y abre una subordinada; «derfor» da la consecuencia y abre una principal."],
    [["fordi", "så"], "«fordi» da la causa; «så» da la consecuencia."],
    [["sin", "hans"], "«sin» apunta al sujeto de la frase; «hans» a otra persona."],
    [["sin", "hennes"], "«sin» apunta al sujeto de la frase; «hennes» a otra persona."],
    [["si", "hennes"], "«si» apunta al sujeto de la frase; «hennes» a otra persona."],
    [["sitt", "hans"], "«sitt» apunta al sujeto de la frase; «hans» a otra persona."],
    [["sine", "deres"], "«sine» apunta al sujeto de la frase; «deres» a otras personas."],
    [["som", "at"], "«som» abre una relativa que describe un nombre; «at» introduce lo que alguien dice o piensa."],
    [["noen", "ingen"], "«noen» en afirmaciones y preguntas; «ingen» en negativas."],
    [["mange", "mye"], "«mange» con lo que se puede contar; «mye» con lo que no."],
    [["har", "hadde"], "«har» más participio mira desde hoy; «hadde» más participio es anterior a otro momento del pasado."],
    [["er", "var"], "«er» es presente; «var» es pasado. Si el verbo de decir está en pasado, lo de dentro retrocede."],
    [["kan", "kunne"], "«kan» es presente; «kunne» es pasado o hipótesis. Si el verbo de decir está en pasado, lo de dentro retrocede."],
    [["må", "måtte"], "«må» es presente; «måtte» es pasado. Si el verbo de decir está en pasado, lo de dentro retrocede."],
    [["skal", "skulle"], "«skal» es presente; «skulle» es pasado o hipótesis."],
    [["vil", "ville"], "«vil» es presente; «ville» es pasado o hipótesis."],
  ];
  var ADVERBIOS = { ikke: 1, alltid: 1, aldri: 1, bare: 1, ofte: 1, "også": 1, fortsatt: 1, allerede: 1, "ennå": 1, kanskje: 1, gjerne: 1, egentlig: 1 };
  var SUBORDINANTES = { at: 1, om: 1, fordi: 1, hvis: 1, "når": 1, da: 1, som: 1, mens: 1, "før": 1, etter: 1, siden: 1, selv: 1, "dersom": 1 };

  // Verbos conjugados frecuentes y terminaciones típicas; sirve solo para elegir la redacción del aviso.
  var VERBOS = { er: 1, var: 1, har: 1, hadde: 1, kan: 1, kunne: 1, "må": 1, "måtte": 1, skal: 1, skulle: 1, vil: 1, ville: 1, "bør": 1, burde: 1, blir: 1, ble: 1, fikk: 1, gikk: 1, kom: 1, sa: 1, "så": 1, tok: 1, dro: 1, sto: 1, fant: 1, gjorde: 1, visste: 1, "må": 1, lot: 1, satt: 1, "lå": 1, ga: 1, spurte: 1, mente: 1, trengte: 1, ringte: 1, sendte: 1, skrev: 1, leste: 1, bodde: 1, jobbet: 1, begynte: 1, flyttet: 1, snakket: 1, forsto: 1, forstod: 1, kjente: 1, hentet: 1, byttet: 1 };
  var NO_VERBOS = { etter: 1, over: 1, under: 1, for: 1, eller: 1, her: 1, der: 1, hver: 1, "vår": 1, deres: 1, mer: 1, "før": 1, siden: 1, "år": 1, uker: 1, timer: 1, dager: 1, ganger: 1, lærer: 1, mening: 1 };
  function pareceVerbo(w) {
    var l = limpiarToken(w);
    if (!l || NO_VERBOS[l]) return false;
    if (VERBOS[l]) return true;
    return /[a-zæøå]{3,}(er|te|dde)$/.test(l) && !/(ing|else|het)er$/.test(l);
  }

  function listaComillas(ws) {
    return ws.map(function (w) { return "«" + w + "»"; }).join(", ");
  }

  function explicacionPar(a, b) {
    var la = String(a).toLowerCase(), lb = String(b).toLowerCase();
    for (var i = 0; i < PARES.length; i++) {
      var par = PARES[i][0];
      if ((par[0] === la && par[1] === lb) || (par[0] === lb && par[1] === la)) return PARES[i][1];
    }
    return "";
  }

  // Alineación por subsecuencia común más larga: qué palabras faltan, sobran o están fuera de sitio.
  function alinear(dado, solucion) {
    var a = dado.map(normalizar), b = solucion.map(normalizar);
    var n = a.length, m = b.length, i, j;
    var t = [];
    for (i = 0; i <= n; i++) { t[i] = []; for (j = 0; j <= m; j++) t[i][j] = 0; }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    var sobran = [], faltan = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) { sobran.push(dado[i]); i++; }
      else { faltan.push(solucion[j]); j++; }
    }
    while (i < n) sobran.push(dado[i++]);
    while (j < m) faltan.push(solucion[j++]);
    return { sobran: sobran, faltan: faltan };
  }

  function diagnosticoOrden(dado, solucion, mecanismo) {
    var partes = [];
    var fuera = [];
    for (var i = 0; i < solucion.length; i++) { if (normalizar(dado[i] || "") !== normalizar(solucion[i])) fuera.push(dado[i] || solucion[i]); }
    if (!fuera.length) return "";
    var intercambio = fuera.length === 2 && solucion.length > 2 && dado.some(function (w, k) { return normalizar(w) === normalizar(solucion[k + 1] || "") && normalizar(dado[k + 1] || "") === normalizar(solucion[k]); });
    if (intercambio) partes.push("Solo has intercambiado " + listaComillas(fuera) + ".");
    else partes.push("Tienes fuera de sitio " + listaComillas(fuera.slice(0, 4)) + (fuera.length > 4 ? " y alguna más" : "") + ".");
    // El verbo conjugado de la solución: si el alumno lo ha retrasado, se dice dónde va.
    var k = -1;
    for (var v = 1; v < solucion.length; v++) { if (pareceVerbo(solucion[v])) { k = v; break; } }
    var verboDicho = false;
    if (k > 0) {
      var posDado = dado.map(normalizar).indexOf(normalizar(solucion[k]));
      if (posDado >= 0 && posDado !== k) {
        partes.push("«" + solucion[k] + "» es el verbo y va justo después de «" + solucion.slice(0, k).join(" ").replace(/[,.]$/, "") + "», en segunda posición.");
        verboDicho = true;
      }
    }
    var seg = !verboDicho && solucion[1] && dado[1] && normalizar(dado[1]) !== normalizar(solucion[1]) && normalizar(dado[0]) === normalizar(solucion[0]);
    if (seg) partes.push("En la frase correcta, «" + solucion[1] + "» va justo después de «" + solucion[0].replace(/[,.]$/, "") + "».");
    var adv = fuera.filter(function (w) { return ADVERBIOS[limpiarToken(w)]; })[0];
    if (adv) {
      var idx = solucion.map(normalizar).indexOf(normalizar(adv));
      var enSub = solucion.slice(0, idx).some(function (w) { return SUBORDINANTES[limpiarToken(w)]; });
      partes.push(enSub ? "«" + adv + "» va delante del verbo porque está dentro de una subordinada." : "«" + adv + "» va detrás del verbo conjugado en la frase principal.");
    }
    if (mecanismo && REGLAS[mecanismo]) partes.push("Regla de la pieza: " + REGLAS[mecanismo]);
    return partes.join(" ");
  }

  function diagnosticoEscrito(texto, respuesta, mecanismo) {
    var dado = tokens(String(texto || "").replace(/[«»"“”]/g, ""));
    var sol = tokens(respuesta);
    if (!dado.length) return "";
    var al = alinear(dado, sol);
    var partes = [];
    var mismoConjunto = al.sobran.length === al.faltan.length && al.sobran.length > 0
      && al.sobran.map(normalizar).sort().join("|") === al.faltan.map(normalizar).sort().join("|");
    if (mismoConjunto) {
      partes.push("Las palabras están, pero no en su sitio: " + listaComillas(al.faltan) + ".");
    } else {
      var erratas = [];
      var faltan = al.faltan.slice(), sobran = al.sobran.slice();
      faltan.forEach(function (f) {
        var cerca = sobran.filter(function (s) { return distancia(normalizar(s), normalizar(f)) <= Math.max(1, Math.floor(normalizar(f).length / 4)); })[0];
        if (cerca) { erratas.push([cerca, f]); sobran.splice(sobran.indexOf(cerca), 1); }
      });
      faltan = faltan.filter(function (f) { return !erratas.some(function (e) { return e[1] === f; }); });
      if (erratas.length) partes.push("Revisa " + erratas.map(function (e) { return "«" + e[0] + "» (en la solución, «" + e[1] + "»)"; }).join(", ") + ".");
      if (faltan.length) partes.push("Te falta " + listaComillas(faltan) + ".");
      if (sobran.length) partes.push("Sobra " + listaComillas(sobran) + ".");
      erratas.forEach(function (e) { var ex = explicacionPar(e[0], e[1]); if (ex) partes.push(ex); });
    }
    if (mecanismo && REGLAS[mecanismo]) partes.push("Regla de la pieza: " + REGLAS[mecanismo]);
    return partes.join(" ");
  }

  function diagnosticoHueco(elegida, correcta, mecanismo) {
    if (!elegida) return "";
    var partes = ["Has puesto «" + elegida + "»; aquí va «" + correcta + "»."];
    var ex = explicacionPar(elegida, correcta);
    if (ex) partes.push(ex);
    else if (mecanismo && REGLAS[mecanismo]) partes.push("Regla de la pieza: " + REGLAS[mecanismo]);
    return partes.join(" ");
  }

  // ---------- Interfaz ----------

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }

  function vibrar(ms) {
    try {
      if (!navigator.vibrate) return;
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      navigator.vibrate(ms);
    } catch (err) { /* nada */ }
  }

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

  function montarOrdena(item, caja, alResolver) {
    var solucion = item.solucion;
    var linea = el("div", "linea-respuesta");
    linea.setAttribute("aria-label", "Tu frase. Toca una palabra para quitarla.");
    var banco = el("div", "banco-fichas");
    banco.setAttribute("aria-label", "Palabras disponibles. Toca una para añadirla a la frase.");
    var fichas = item.fichas.map(function (t) { var f = botonFicha(t); banco.appendChild(f); return f; });

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
        if (ref !== f) linea.insertBefore(f, ref);
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
        alSoltar: mover,
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
    var comprobar = el("button", "btn", "Comprobar");
    comprobar.type = "button";
    comprobar.disabled = true;

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
        alTocar: colocar,
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
    comprobar.addEventListener("click", function () {
      var bien = colocada && normalizar(colocada.textContent) === normalizar(item.respuesta);
      hueco.classList.add(bien ? "bien" : "mal");
      if (!bien) { hueco.textContent = item.respuesta; hueco.classList.add("corregido"); }
      fichas.forEach(function (f) { f.disabled = true; });
      comprobar.disabled = true;
      alResolver(!!bien, colocada ? colocada.textContent : "");
    });
    caja.appendChild(frase);
    if (item.es) caja.appendChild(el("p", "ayuda-item", item.es));
    caja.appendChild(banco);
    caja.appendChild(comprobar);
  }

  function montarEmpareja(item, caja, alResolver) {
    var cols = el("div", "parejas");
    var izq = el("div", "col izq"), der = el("div", "col der");
    var seleccion = null, hechas = 0, fallos = 0;
    item.derecha.forEach(function (es) {
      var t = el("button", "tarjeta es", es);
      t.type = "button";
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
        if (!item.confusiones) item.confusiones = [];
        if (item.confusiones.length < 2) item.confusiones.push({ no: fNo.textContent, es: tEs.textContent, correcto: par ? par.es : "" });
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
    caja.appendChild(el("p", "ayuda-item", item.fuente === "anexo"
      ? "Arrastra cada expresión hasta su significado, o toca una y después la otra."
      : "Arrastra cada frase noruega hasta su significado, o toca una y después la otra."));
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
      if (item.opcionesNb || /[æøå]/i.test(op)) t.lang = "nb";
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
      campo.disabled = true; comprobar.disabled = true; pista.disabled = true;
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

  var TITULOS = { mc: "Elige la respuesta", elige: "Elige la correcta", ordena: "Ordena la frase", transforma: "Transforma la frase", completa: "Completa el hueco", empareja: "Empareja", escribe: "Escríbela tú" };
  var NOMBRES_FILTRO = { todos: "Todo", mc: "Preguntas", elige: "Elegir", ordena: "Ordenar", completa: "Huecos", empareja: "Emparejar", transforma: "Transformar", escribe: "Escribir", anexo: "Expresiones" };

  function montarItem(item, indice, total, alResolver) {
    var tarjeta = el("section", "ejercicio tipo-" + item.tipo);
    var cab = el("div", "ejercicio-cab");
    cab.appendChild(el("span", "eti", (indice + 1) + " de " + total + " · " + TITULOS[item.tipo] + (item.fuente === "anexo" ? " · expresiones" : "")));
    tarjeta.appendChild(cab);
    var caja = el("div", "ejercicio-cuerpo");
    if (item.tipo === "ordena") {
      if (item.pista) {
        caja.appendChild(el("p", "consigna", item.parcial ? "Construye el arranque noruego que significa:" : (item.fuente === "fichas" && item.pista.length > 60 ? "Construye la frase que resuelve esto:" : "Construye la frase noruega que significa:")));
        caja.appendChild(el("p", "pista-es", item.pista + (item.parcial ? "…" : "")));
      } else {
        caja.appendChild(el("p", "consigna", "Ordena las palabras hasta que la frase esté bien construida."));
      }
      montarOrdena(item, caja, alResolver);
    } else if (item.tipo === "transforma") {
      var origen = el("div", "origen" + (item.entradaMal ? " mal" : ""));
      origen.appendChild(el("span", "eti", item.etqEntrada || "Frase"));
      var pe = el("p", "frase-origen", item.entrada); pe.lang = "nb"; origen.appendChild(pe);
      if (item.instruccion) origen.appendChild(el("p", "instruccion", item.instruccion));
      caja.appendChild(origen);
      caja.appendChild(el("p", "consigna", (item.entradaMal ? "Corrígela. " : "") + (item.etqSalida || "Resuelto") + ". Ordena las palabras:"));
      montarOrdena(item, caja, alResolver);
    } else if (item.tipo === "completa") {
      caja.appendChild(el("p", "consigna", "Arrastra la palabra que falta al hueco, o tócala."));
      montarCompleta(item, caja, alResolver);
    } else if (item.tipo === "empareja") {
      montarEmpareja(item, caja, alResolver);
    } else if (item.tipo === "mc" || item.tipo === "elige") {
      montarMc(item, caja, alResolver);
    } else if (item.tipo === "escribe") {
      montarEscribe(item, caja, alResolver);
    }
    tarjeta.appendChild(caja);
    return tarjeta;
  }

  function textoFeedback(item, bien) {
    if (item.tipo === "mc" || item.tipo === "elige") return item.explicacion || "";
    if (item.tipo === "transforma") return item.motivo || "";
    if (item.tipo === "escribe") return item.explicacion || "";
    if (item.tipo === "completa") return item.motivo || (bien ? "" : (item.es ? "La palabra era «" + item.respuesta + "». " + item.es : "La palabra era «" + item.respuesta + "»."));
    if (item.tipo === "ordena") return item.motivo || (bien ? "" : item.pista);
    return "";
  }

  function fraseSolucion(item) {
    if (item.tipo === "ordena" || item.tipo === "transforma" || item.tipo === "escribe") return item.frase || item.respuesta || item.solucion.join(" ");
    if (item.tipo === "completa") return item.frase;
    return "";
  }

  function diagnosticar(item, dado, mecanismo) {
    try {
      if (item.tipo === "ordena" || item.tipo === "transforma") return diagnosticoOrden(tokens(dado), item.solucion, mecanismo);
      if (item.tipo === "escribe") {
        var ts = tokens(String(dado || "").replace(/[«»"“”]/g, ""));
        var mismoConjunto = ts.length === item.solucion.length && ts.map(normalizar).sort().join("|") === item.solucion.map(normalizar).sort().join("|");
        return mismoConjunto ? diagnosticoOrden(ts, item.solucion, mecanismo) : diagnosticoEscrito(dado, item.respuesta, mecanismo);
      }
      if (item.tipo === "completa") return diagnosticoHueco(dado, item.respuesta, mecanismo);
      if (item.tipo === "empareja" && item.confusiones && item.confusiones.length) {
        return item.confusiones.map(function (c) { return "Has unido «" + c.no + "» con «" + c.es + "»; en realidad significa «" + c.correcto + "»."; }).join(" ");
      }
    } catch (err) { return ""; }
    return "";
  }

  function numero(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }

  function registroDe(estado, codigo) {
    if (!estado.practica) estado.practica = {};
    var r = estado.practica[codigo] || {};
    r.tandas = r.tandas || 0;
    r.mejor = r.mejor || null;
    r.ultimo = r.ultimo || null;
    r.falladas = Array.isArray(r.falladas) ? r.falladas : [];
    r.vistos = Array.isArray(r.vistos) ? r.vistos : [];
    r.hechos = r.hechos || 0;
    r.aciertos = r.aciertos || 0;
    r.filtro = r.filtro || "todos";
    estado.practica[codigo] = r;
    return r;
  }

  // ---------- Repaso espaciado entre piezas ----------
  // Lo que fallas en cualquier mecanismo vuelve a salir al día siguiente y, si lo
  // aciertas, a los 3, 7 y 14 días. Después se da por asentado. Solo guarda ids.

  var CONTACTOS_REPASO = [1, 3, 7, 14];

  function repasoDe(estado) {
    if (!estado.repaso || typeof estado.repaso !== "object") estado.repaso = { items: {} };
    if (!estado.repaso.items) estado.repaso.items = {};
    return estado.repaso;
  }

  function sumarDias(fecha, dias) {
    var d = new Date(fecha);
    d.setDate(d.getDate() + dias);
    d.setHours(5, 0, 0, 0);
    return d.toISOString();
  }

  function programarRepaso(estado, codigoPieza, item, acierto, ahora) {
    var r = repasoDe(estado);
    var clave = codigoPieza + "|" + item.id;
    var actual = r.items[clave];
    var hoy = ahora || new Date();
    if (!acierto) {
      r.items[clave] = { pieza: codigoPieza, id: item.id, tipo: item.tipo, contacto: 0, vence: sumarDias(hoy, CONTACTOS_REPASO[0]), fallos: (actual ? actual.fallos || 0 : 0) + 1, ultimo: hoy.toISOString() };
      return r.items[clave];
    }
    if (!actual) return null;
    var siguiente = (actual.contacto || 0) + 1;
    if (siguiente >= CONTACTOS_REPASO.length) { delete r.items[clave]; return null; }
    actual.contacto = siguiente;
    actual.vence = sumarDias(hoy, CONTACTOS_REPASO[siguiente]);
    actual.ultimo = hoy.toISOString();
    return actual;
  }

  function repasoPendiente(estado, ahora) {
    var r = repasoDe(estado);
    var limite = (ahora || new Date()).getTime();
    var todos = Object.keys(r.items).map(function (k) { return r.items[k]; });
    var vencidos = todos.filter(function (x) { return Date.parse(x.vence) <= limite; }).sort(function (a, b) { return Date.parse(a.vence) - Date.parse(b.vence); });
    var futuros = todos.filter(function (x) { return Date.parse(x.vence) > limite; }).sort(function (a, b) { return Date.parse(a.vence) - Date.parse(b.vence); });
    var piezas = {};
    vencidos.forEach(function (x) { piezas[x.pieza] = true; });
    return { vencidos: vencidos, futuros: futuros, total: todos.length, piezas: Object.keys(piezas), proximo: futuros.length ? futuros[0].vence : null };
  }

  // ---------- Tanda ----------
  // Pinta una serie de ejercicios con barra, corrección y resumen. La usan la
  // práctica de una pieza y el repaso entre piezas.
  // ctx: { registroDe(item) -> registro, alResolver(item, acierto), resumen(resultados, items) -> nodo }
  function montarTandaEnRaiz(raiz, items, ctx) {
    var barra = el("div", "practica-barra");
    var puntos = items.map(function () { var p = el("i"); barra.appendChild(p); return p; });
    raiz.appendChild(barra);
    var escenario = el("div", "practica-escenario");
    raiz.appendChild(escenario);
    var indice = 0, resultados = [];

    function mostrar() {
      escenario.innerHTML = "";
      if (indice >= items.length) {
        puntos.forEach(function (p, i) { p.className = resultados[i] ? "ok" : "ko"; });
        var caja = ctx.resumen(resultados, items);
        escenario.appendChild(caja);
        caja.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      var item = items[indice];
      puntos.forEach(function (p, i) { p.className = i < indice ? (resultados[i] ? "ok" : "ko") : (i === indice ? "actual" : ""); });
      var tarjeta = montarItem(item, indice, items.length, function (bien, dado, conPista) {
        var acierto = bien && !conPista;
        resultados[indice] = acierto;
        ctx.alResolver(item, acierto);
        vibrar(acierto ? 10 : [30, 40, 30]);
        var fb = el("div", "feedback " + (acierto ? "bien" : "mal"));
        fb.setAttribute("role", "status");
        var titulosError = {
          ordena: "Revisa el orden.",
          completa: "Revisa el hueco.",
          elige: "Compara las opciones.",
          empareja: "Revisa la pareja.",
          transforma: "Revisa el cambio.",
          escribe: "Compara tu frase.",
          mc: "Compara las opciones.",
        };
        fb.appendChild(el("b", null, acierto ? "Bien." : (bien && conPista ? "Con ayuda, pero bien." : (titulosError[item.tipo] || "Revísalo una vez más."))));
        var diag = acierto ? "" : diagnosticar(item, dado, item.mecanismo);
        if (diag) fb.appendChild(el("p", "diagnostico", diag));
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
      if (ctx.etiquetaPieza && item.mecanismo) tarjeta.querySelector(".ejercicio-cab").appendChild(el("span", "eti-pieza", item.mecanismo));
      escenario.appendChild(tarjeta);
      if (indice > 0) tarjeta.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    mostrar();
  }

  // Monta la práctica completa de una pieza.
  // opciones: { estado, guardar, anexoHtml, alTerminar, soloFalladas, filtro }
  function montar(pieza, opciones) {
    var estado = opciones.estado;
    var registro = registroDe(estado, pieza.codigo);
    var b = banco(pieza, opciones.anexoHtml || null);
    if (!b.items.length) return null;
    if (opciones.filtro) { registro.filtro = opciones.filtro; opciones.guardar(); }
    var filtro = registro.filtro || "todos";
    if (!filtrar(b.items, filtro).length) filtro = "todos";

    var raiz = el("section", "practica-pieza");
    raiz.id = "practica";

    var cab = el("div", "practica-cab");
    cab.appendChild(el("p", "kicker", "Ponlo a prueba"));
    cab.appendChild(el("h2", null, "Practica " + pieza.codigo + " sin salir de aquí"));
    cab.appendChild(el("p", "practica-intro", "Esta pieza tiene " + numero(b.items.length) + " ejercicios hechos con sus propias frases: elegir, ordenar arrastrando, completar, emparejar, transformar y escribir. Van de ocho en ocho, sin repetir hasta que los hayas visto todos, y cada uno te dice al momento cómo ha ido y por qué. Lo que falles vuelve a salir en el repaso del índice."));
    var stats = el("p", "practica-stats");
    function pintarStats() {
      stats.textContent = "Hechos " + numero(registro.hechos) + " de " + numero(b.items.length)
        + (registro.hechos ? " · aciertos " + Math.round(100 * registro.aciertos / Math.max(1, registro.hechos)) + " %" : "")
        + (registro.mejor ? " · mejor tanda " + registro.mejor.aciertos + " de " + registro.mejor.total : "");
    }
    pintarStats();
    cab.appendChild(stats);

    var filtros = el("div", "practica-filtros");
    filtros.setAttribute("role", "group");
    filtros.setAttribute("aria-label", "Tipo de ejercicio");
    var claves = ["todos"].concat(ORDEN_TIPOS.filter(function (t) { return b.porTipo[t]; }));
    if (b.porFuente.anexo) claves.push("anexo");
    claves.forEach(function (k) {
      var n = k === "todos" ? b.items.length : (k === "anexo" ? b.porFuente.anexo : b.porTipo[k]);
      var chipF = el("button", "chip-filtro" + (k === filtro ? " activo" : ""), NOMBRES_FILTRO[k] + " · " + n);
      chipF.type = "button";
      chipF.setAttribute("aria-pressed", k === filtro ? "true" : "false");
      chipF.addEventListener("click", function () {
        if (k === filtro) return;
        var nuevo = montar(pieza, Object.assign({}, opciones, { soloFalladas: null, filtro: k }));
        raiz.replaceWith(nuevo);
        nuevo.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      filtros.appendChild(chipF);
    });
    cab.appendChild(filtros);
    raiz.appendChild(cab);

    var vistosMapa = {};
    registro.vistos.forEach(function (id) { vistosMapa[id] = true; });
    var seleccion;
    if (opciones.soloFalladas && opciones.soloFalladas.length) {
      seleccion = { items: b.items.filter(function (it) { return opciones.soloFalladas.indexOf(it.id) >= 0; }), reinicio: false, restantes: 0 };
    }
    if (!seleccion || !seleccion.items.length) {
      seleccion = tanda(filtrar(b.items, filtro), { vistos: vistosMapa, semilla: pieza.codigo + ":" + filtro + ":" + registro.tandas });
    }
    var items = seleccion.items;
    if (seleccion.reinicio && registro.vistos.length) {
      raiz.appendChild(el("p", "practica-aviso", "Ya has pasado por todos los ejercicios de este tipo. Vuelven mezclados, así que es una vuelta más de repaso."));
      var delFiltro = {};
      filtrar(b.items, filtro).forEach(function (it) { delFiltro[it.id] = true; });
      registro.vistos = registro.vistos.filter(function (id) { return !delFiltro[id]; });
      opciones.guardar();
    }

    var aciertos = 0;
    montarTandaEnRaiz(raiz, items, {
      alResolver: function (item, acierto) {
        if (acierto) aciertos++;
        if (registro.vistos.indexOf(item.id) < 0) registro.vistos.push(item.id);
        if (registro.vistos.length > MAX_VISTOS) registro.vistos = registro.vistos.slice(-MAX_VISTOS);
        registro.hechos++;
        if (acierto) registro.aciertos++;
        programarRepaso(estado, pieza.codigo, item, acierto);
        opciones.guardar();
        pintarStats();
      },
      resumen: function (resultados, items) {
        var total = items.length;
        var falladas = items.filter(function (it, i) { return !resultados[i]; }).map(function (it) { return it.id; });
        registro.tandas++;
        registro.ultimo = { aciertos: aciertos, total: total, fecha: new Date().toISOString() };
        if (!registro.mejor || aciertos / total > registro.mejor.aciertos / registro.mejor.total) registro.mejor = { aciertos: aciertos, total: total };
        registro.falladas = falladas;
        opciones.guardar();
        pintarStats();

        var quedan = filtrar(b.items, filtro).filter(function (it) { return registro.vistos.indexOf(it.id) < 0; }).length;
        var caja = el("section", "resumen-practica " + (aciertos === total ? "pleno" : aciertos >= total * 0.6 ? "bien" : "flojo"));
        caja.appendChild(el("p", "eti", "Resultado de la tanda"));
        caja.appendChild(el("p", "marcador", aciertos + " de " + total));
        caja.appendChild(el("p", "lectura", aciertos === total
          ? "Todo bien. " + (quedan ? "Te quedan " + numero(quedan) + " ejercicios distintos en esta pieza." : "Has visto todos los de esta pieza: a partir de aquí es repaso.")
          : aciertos >= total * 0.6
            ? "Va saliendo. Las " + falladas.length + " que han fallado vuelven mañana en el repaso del índice. " + (quedan ? "Quedan " + numero(quedan) + " sin ver." : "Ya has visto todos los de esta pieza.")
            : "Todavía no está asentado. Vuelve al mecanismo, lee el contraste y repite las falladas; mañana te esperan en el repaso del índice."));
        var acciones = el("div", "fila-acciones");
        if (falladas.length) {
          var rep = el("button", "btn", "Repetir las falladas (" + falladas.length + ")");
          rep.type = "button";
          rep.addEventListener("click", function () {
            var nuevo = montar(pieza, Object.assign({}, opciones, { soloFalladas: falladas }));
            raiz.replaceWith(nuevo);
            nuevo.scrollIntoView({ block: "start", behavior: "smooth" });
          });
          acciones.appendChild(rep);
        }
        var seguir = el("button", "btn" + (falladas.length ? " ghost" : ""), quedan ? "Seguir · " + numero(quedan) + " por ver" : "Otra vuelta de repaso");
        seguir.type = "button";
        seguir.addEventListener("click", function () {
          var nuevo = montar(pieza, Object.assign({}, opciones, { soloFalladas: null }));
          raiz.replaceWith(nuevo);
          nuevo.scrollIntoView({ block: "start", behavior: "smooth" });
        });
        acciones.appendChild(seguir);
        caja.appendChild(acciones);
        if (opciones.alTerminar) opciones.alTerminar(registro);
        return caja;
      },
    });
    return raiz;
  }

  // Repaso del día: ejercicios vencidos de varias piezas.
  // entradas: [{ pieza, item }] ya resueltos por la app; opciones: { estado, guardar, alVolver }
  function montarRepaso(entradas, opciones) {
    var estado = opciones.estado;
    var items = entradas.map(function (e) { return e.item; });
    var raiz = el("section", "practica-pieza repaso-pieza");
    raiz.id = "repaso";
    var cab = el("div", "practica-cab");
    cab.appendChild(el("p", "kicker", "Repaso"));
    cab.appendChild(el("h2", null, "Lo que fallaste vuelve hoy"));
    var piezas = [];
    entradas.forEach(function (e) { if (piezas.indexOf(e.pieza) < 0) piezas.push(e.pieza); });
    cab.appendChild(el("p", "practica-intro", items.length + (items.length === 1 ? " ejercicio" : " ejercicios") + " de " + (piezas.length === 1 ? "la pieza " : "las piezas ") + piezas.join(", ") + ". Si lo aciertas hoy, vuelve a los 3 días, después a los 7 y a los 14. Si vuelves a fallar, mañana otra vez."));
    raiz.appendChild(cab);
    var aciertos = 0;
    montarTandaEnRaiz(raiz, items, {
      etiquetaPieza: true,
      alResolver: function (item, acierto) {
        if (acierto) aciertos++;
        var registro = registroDe(estado, item.mecanismo);
        registro.hechos++;
        if (acierto) registro.aciertos++;
        programarRepaso(estado, item.mecanismo, item, acierto);
        opciones.guardar();
      },
      resumen: function (resultados, items) {
        var total = items.length;
        var pendiente = repasoPendiente(estado);
        var caja = el("section", "resumen-practica " + (aciertos === total ? "pleno" : aciertos >= total * 0.6 ? "bien" : "flojo"));
        caja.appendChild(el("p", "eti", "Repaso hecho"));
        caja.appendChild(el("p", "marcador", aciertos + " de " + total));
        caja.appendChild(el("p", "lectura", (aciertos === total ? "Todo asentado por hoy. " : "Lo que ha fallado vuelve mañana. ")
          + (pendiente.vencidos.length ? "Te quedan " + pendiente.vencidos.length + " ejercicios más vencidos." : (pendiente.proximo ? "El próximo repaso te espera el " + new Date(pendiente.proximo).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + "." : "No queda nada programado: lo que falles a partir de ahora volverá aquí."))));
        var acciones = el("div", "fila-acciones");
        if (pendiente.vencidos.length) {
          var seguir = el("button", "btn", "Seguir repasando");
          seguir.type = "button";
          seguir.addEventListener("click", function () { if (opciones.alSeguir) opciones.alSeguir(); });
          acciones.appendChild(seguir);
        }
        var volver = el("button", "btn" + (pendiente.vencidos.length ? " ghost" : ""), "Volver al curso");
        volver.type = "button";
        volver.addEventListener("click", function () { if (opciones.alVolver) opciones.alVolver(); });
        acciones.appendChild(volver);
        caja.appendChild(acciones);
        return caja;
      },
    });
    return raiz;
  }

  function llamada(pieza, estado, total) {
    var registro = estado.practica && estado.practica[pieza.codigo];
    var caja = el("a", "practica-llamada");
    caja.href = "#practica";
    caja.appendChild(el("span", "eti", "Ponlo a prueba"));
    var txt = el("span", "txt");
    var hechos = registro ? registro.hechos || 0 : 0;
    txt.appendChild(el("strong", null, hechos ? "Seguir practicando" : (total ? numero(total) + " ejercicios interactivos" : "Ejercicios interactivos")));
    txt.appendChild(el("small", null, hechos
      ? "Llevas " + numero(hechos) + (total ? " de " + numero(total) : "") + ". Arrastra, elige, completa y escribe con las frases de este mecanismo."
      : "En esta sesión: arrastra, elige, completa, empareja y escribe con las frases del mecanismo, de ocho en ocho."));
    caja.appendChild(txt);
    caja.appendChild(el("span", "flecha", "↓"));
    caja.addEventListener("click", function (e) {
      var destino = document.getElementById("practica");
      if (destino) { e.preventDefault(); destino.scrollIntoView({ block: "start", behavior: "smooth" }); }
    });
    return caja;
  }

  root.NexoPractica = Object.freeze({ extraer: extraer, banco: banco, tanda: tanda, filtrar: filtrar, montar: montar, montarRepaso: montarRepaso, programarRepaso: programarRepaso, repasoPendiente: repasoPendiente, llamada: llamada, seccionAnexo: seccionAnexo, diagnosticar: diagnosticar, REGLAS: REGLAS, TANDA: TANDA });
})(typeof window !== "undefined" ? window : globalThis);

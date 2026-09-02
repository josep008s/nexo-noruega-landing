// Estado minimo, local y determinista para la recuperacion 1-3-7-14.
// No guarda respuestas, transcripciones, audio ni texto libre del alumno.
(function (root) {
  "use strict";

  var CONTACTOS = Object.freeze([
    Object.freeze({ contacto: 1, dias: 0, operacion_id: "BUILD_WITH_SUPPORT" }),
    Object.freeze({ contacto: 3, dias: 2, operacion_id: "RETRIEVE_LESS_SUPPORT" }),
    Object.freeze({ contacto: 7, dias: 6, operacion_id: "VARY_TWO_DATA" }),
    Object.freeze({ contacto: 14, dias: 13, operacion_id: "TRANSFER_NEW_CONTEXT" }),
  ]);

  var ID_SEGURO = /^[A-Z0-9:_-]{1,96}$/i;

  function idSeguro(valor) {
    return typeof valor === "string" && ID_SEGURO.test(valor) ? valor : null;
  }

  function fechaValida(valor) {
    var ms = Date.parse(valor);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  function sumarDias(iso, dias) {
    var d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString();
  }

  function normalizarCola(valor) {
    if (!Array.isArray(valor)) return [];
    var vistos = Object.create(null);
    return valor.reduce(function (cola, item) {
      if (!item || typeof item !== "object") return cola;
      var recoveryId = idSeguro(item.recovery_id);
      var focusId = idSeguro(item.focus_id);
      var sourceId = idSeguro(item.source_id);
      var operacionId = idSeguro(item.operacion_id);
      var contacto = Number(item.contacto);
      var programadaEn = fechaValida(item.programada_en);
      var estado = item.estado === "DONE" ? "DONE" : item.estado === "PENDING" ? "PENDING" : null;
      var completadaEn = item.completada_en === null || item.completada_en === undefined
        ? null
        : fechaValida(item.completada_en);
      if (!recoveryId || vistos[recoveryId] || !focusId || !sourceId || !operacionId
          || ![1, 3, 7, 14].includes(contacto) || !programadaEn || !estado
          || (estado === "DONE" && !completadaEn)) return cola;
      vistos[recoveryId] = true;
      cola.push({
        recovery_id: recoveryId,
        focus_id: focusId,
        source_id: sourceId,
        contacto: contacto,
        operacion_id: operacionId,
        programada_en: programadaEn,
        estado: estado,
        completada_en: estado === "DONE" ? completadaEn : null,
      });
      return cola;
    }, []);
  }

  function programar(colaActual, focoId, fuenteId, fechaBase) {
    var focusId = idSeguro(focoId);
    var sourceId = idSeguro(fuenteId);
    var base = fechaValida(fechaBase || new Date().toISOString());
    if (!focusId || !sourceId || !base) throw new Error("recuperacion_invalida");

    var cola = normalizarCola(colaActual);
    var existentes = new Set(cola.map(function (x) { return x.recovery_id; }));
    CONTACTOS.forEach(function (regla) {
      var recoveryId = "REC:" + focusId + ":" + regla.contacto;
      if (existentes.has(recoveryId)) return;
      cola.push({
        recovery_id: recoveryId,
        focus_id: focusId,
        source_id: sourceId,
        contacto: regla.contacto,
        operacion_id: regla.operacion_id,
        programada_en: sumarDias(base, regla.dias),
        estado: "PENDING",
        completada_en: null,
      });
      existentes.add(recoveryId);
    });
    return normalizarCola(cola);
  }

  function primeraVencida(colaActual, ahora) {
    var limite = Date.parse(ahora || new Date().toISOString());
    if (!Number.isFinite(limite)) throw new Error("fecha_invalida");
    return normalizarCola(colaActual)
      .filter(function (x) {
        return x.estado === "PENDING" && Date.parse(x.programada_en) <= limite;
      })
      .sort(function (a, b) {
        return Date.parse(a.programada_en) - Date.parse(b.programada_en)
          || a.contacto - b.contacto
          || a.recovery_id.localeCompare(b.recovery_id);
      })[0] || null;
  }

  function completarVencida(colaActual, recoveryId, ahora) {
    var id = idSeguro(recoveryId);
    var completadaEn = fechaValida(ahora || new Date().toISOString());
    if (!id || !completadaEn) throw new Error("recuperacion_invalida");
    var cola = normalizarCola(colaActual);
    var primera = primeraVencida(cola, completadaEn);
    if (!primera || primera.recovery_id !== id) throw new Error("recuperacion_fuera_de_orden");
    return cola.map(function (x) {
      if (x.recovery_id !== id) return x;
      return Object.assign({}, x, { estado: "DONE", completada_en: completadaEn });
    });
  }

  root.NexoLarsitoLearning = Object.freeze({
    CONTACTOS: CONTACTOS,
    normalizarCola: normalizarCola,
    programar: programar,
    primeraVencida: primeraVencida,
    completarVencida: completarVencida,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);

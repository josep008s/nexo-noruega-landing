import assert from "node:assert/strict";
import handler from "../api/norsk-comercial.js";

function respuesta() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    end(valor) { this.body = valor; },
  };
}

async function probar(ruta, method, query, esperado) {
  const req = { method, url: ruta, query: query || {}, headers: {} };
  const res = respuesta();
  await handler(req, res);
  assert.equal(res.statusCode, esperado, `${ruta || "desconocida"}: status`);
}

await probar("/api/norsk-activar/", "GET", {}, 302);
await probar("/api/norsk-checkout/", "GET", {}, 405);
await probar("/api/norsk-gracias/", "GET", {}, 400);
await probar("/api/norsk-reenviar/", "GET", {}, 405);
await probar("/api/norsk-webhook/", "GET", {}, 405);
await probar("/api/norsk-comercial/", "GET", {}, 404);
await probar("/api/norsk-checkout/?route=activar", "GET", { route: "activar" }, 405);

console.log("PASS norsk_comercial_router_selftest: 7 rutas sin red");

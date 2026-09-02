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

async function probar(route, method, query, esperado) {
  const req = { method, query: { route, ...(query || {}) }, headers: {} };
  const res = respuesta();
  await handler(req, res);
  assert.equal(res.statusCode, esperado, `${route || "desconocida"}: status`);
}

await probar("activar", "GET", {}, 302);
await probar("checkout", "GET", {}, 405);
await probar("gracias", "GET", {}, 400);
await probar("reenviar", "GET", {}, 405);
await probar("webhook", "GET", {}, 405);
await probar("desconocida", "GET", {}, 404);

console.log("PASS norsk_comercial_router_selftest: 6 rutas sin red");

import assert from "node:assert/strict";
import { Readable } from "node:stream";
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

async function probar(ruta, method, query, esperado, cuerpo) {
  const req = cuerpo === undefined ? {} : Readable.from([cuerpo]);
  req.method = method;
  req.url = ruta;
  req.query = query || {};
  req.headers = cuerpo === undefined
    ? {}
    : { "content-length": String(Buffer.byteLength(cuerpo, "utf8")) };
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
await probar("/api/norsk-checkout/", "POST", {}, 400, "{");
await probar("/api/norsk-checkout/", "POST", {}, 413, JSON.stringify({ relleno: "x".repeat(2050) }));
await probar("/api/norsk-reenviar/", "POST", {}, 400, "{");
await probar("/api/norsk-reenviar/", "POST", {}, 413, JSON.stringify({ relleno: "x".repeat(2050) }));
await probar("/api/norsk-reenviar/", "POST", {}, 200, JSON.stringify({ email: "no-es-correo" }));

console.log("PASS norsk_comercial_router_selftest: 12 casos sin red");

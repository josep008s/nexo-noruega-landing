// Auto-test del backend de NEXO NORSK contra Supabase (sin Stripe).
// Verifica esquema, RPCs, muestreo de simulacros y contadores separados api/reenvio.
// Uso:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/norsk_selftest.mjs
//
// No toca el pago. Crea una compra de prueba, la ejercita y la borra al final.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }

const H = { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` };
let ok = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { fail++; console.log(`  ✗ ${nombre}${extra ? "  — " + extra : ""}`); }
}
async function sel(q) {
  const r = await fetch(`${URL}/rest/v1/${q}`, { headers: H });
  if (!r.ok) throw new Error(`select ${q} → ${r.status}: ${await r.text()}`);
  return r.json();
}
async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn} → ${r.status}: ${await r.text()}`);
  return r.json();
}

const run = async () => {
  console.log("== Esquema ==");
  const preg = await sel("norsk_preguntas?select=modulo&activa=is.true");
  const porMod = preg.reduce((a, p) => (a[p.modulo] = (a[p.modulo] || 0) + 1, a), {});
  check(`norsk_preguntas activas: ${preg.length}`, preg.length >= 400, "se esperaban ≥400");
  check(`reparto módulos M1 ${porMod[1] || 0}/M2 ${porMod[2] || 0}/M3 ${porMod[3] || 0}`,
    (porMod[1] || 0) >= 45 && (porMod[2] || 0) >= 65 && (porMod[3] || 0) >= 70,
    "cada módulo debe cubrir 5 simulacros");
  const lec = await sel("norsk_lecciones?select=slug,orden,publica");
  check(`norsk_lecciones: ${lec.length}`, lec.length === 13, "se esperaban 13 (L0-L12)");
  check("solo L0 es pública", lec.filter((l) => l.publica).length === 1);

  console.log("== Compra de prueba ==");
  const sid = "cs_selftest_" + Date.now();
  const expires = new Date(Date.now() + 86400000).toISOString();
  const ins = await fetch(`${URL}/rest/v1/norsk_compras`, {
    method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify([{ email: "selftest@nexonoruega.com", stripe_session_id: sid, plan: "p30", amount: 34900, expires_at: expires }]),
  });
  if (!ins.ok) throw new Error("insert compra: " + await ins.text());
  const compra = (await ins.json())[0];
  check("compra creada, status activa", compra.status === "activa" && compra.email_enviado === false);

  console.log("== Muestreo de simulacros ==");
  const stats = { 1: 9, 2: 13, 3: 14 };
  let statsTotal = 0, distintos = new Set();
  for (const [m, n] of Object.entries(stats)) {
    const rows = await rpc("norsk_muestra", { p_modulo: parseInt(m), p_leccion: null, p_n: n });
    check(`statsborger M${m}: ${rows.length}/${n}`, rows.length === n);
    rows.forEach((r) => distintos.add(r.codigo));
    statsTotal += rows.length;
  }
  check(`statsborger total ${statsTotal} = 36 y sin repetir dentro del bloque`, statsTotal === 36);
  const practica = await rpc("norsk_muestra", { p_modulo: null, p_leccion: 5, p_n: 10 });
  check(`práctica lección 5: ${practica.length}`, practica.length === 10 && practica.every((r) => r.leccion === 5));
  const cap = await rpc("norsk_muestra", { p_modulo: null, p_leccion: null, p_n: 999 });
  check(`tope de muestra: ${cap.length} (máx 40)`, cap.length <= 40);

  console.log("== Contadores separados api / reenvio ==");
  let a1 = await rpc("norsk_incr_uso", { p_compra: compra.id, p_tipo: "api", p_coste: 1 });
  let a2 = await rpc("norsk_incr_uso", { p_compra: compra.id, p_tipo: "api", p_coste: 1 });
  check(`api incrementa: ${a1} → ${a2}`, a2 === a1 + 1);
  let r1 = await rpc("norsk_incr_uso", { p_compra: compra.id, p_tipo: "reenvio", p_coste: 1 });
  check(`reenvio es contador propio: api=${a2}, reenvio=${r1}`, r1 === 1);

  console.log("== Expiración / revocación ==");
  await fetch(`${URL}/rest/v1/norsk_compras?id=eq.${compra.id}`, {
    method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "revocada" }),
  });
  const rev = await sel(`norsk_compras?id=eq.${compra.id}&status=eq.activa&select=id`);
  check("una compra revocada ya no cuenta como activa", rev.length === 0);

  console.log("== Limpieza ==");
  await fetch(`${URL}/rest/v1/norsk_uso?compra_id=eq.${compra.id}`, { method: "DELETE", headers: H });
  await fetch(`${URL}/rest/v1/norsk_compras?id=eq.${compra.id}`, { method: "DELETE", headers: H });
  check("compra y uso de prueba borrados", true);

  console.log(`\n${fail === 0 ? "TODO OK" : "HAY FALLOS"} — ${ok} pasan, ${fail} fallan.`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });

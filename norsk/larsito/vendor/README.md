# Cliente de ElevenLabs vendorizado

`elevenlabs-client-1.23.0.iife.js` parte de `package/dist/lib.iife.js` del paquete
oficial `@elevenlabs/client@1.23.0`. La única modificación es retirar el comentario
final `sourceMappingURL`, porque ese mapa no forma parte de los activos vendorizados.

- Licencia: MIT; texto incluido en `LICENSE.elevenlabs-client`.
- Integridad npm del paquete: `sha512-ifYtIqgHwIcPdZuNLtz+B2h0hc+O8kiA3LBxhKMLUrywMkCWKfGRxBRdFRv8Xpc0+SJCktLFAgvgIHrHdpPEGw==`.
- SHA-256 del IIFE saneado: `dbeb4666c9a59efcba61e96c50503a17e1f64b02216d1fca73bb8861e97d3efc`.

Para renovarlo, descarga con `npm pack @elevenlabs/client@<versión>`, extrae
`package/dist/lib.iife.js`, retira solo su comentario `sourceMappingURL`, conserva
la licencia y actualiza a la vez la versión, la integridad y el hash. No uses una
URL de CDN en producción.

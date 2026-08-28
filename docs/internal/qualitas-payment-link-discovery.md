# Descubrimiento del flujo de pago Quálitas

Fecha de revisión: 2026-08-26

## Evidencia pública observada

- La entrada pública es `https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/inicio`.
- La página muestra un formulario `POST` para consultar el número de póliza.
- El campo visible es `numPoliza`, con validación JavaScript de 10 dígitos.
- La solicitud inicial incluye un campo oculto dinámico y una sesión `JSESSIONID`; sus valores no se guardan aquí.
- El HTML inicial indica que el flujo es para pólizas individuales dentro de la vigencia del recibo y no muestra todavía el formulario de correo ni la acción final.
- Se observaron recursos/cookies de Incapsula. No se ha determinado si el flujo normal dispara un challenge.

## Flujo visual autorizado observado

- Una póliza válida avanza a `/web/qmx/pago-de-poliza/-/user-pago/pago-tdc`.
- Se muestran datos de póliza, vehículo y recibos pendientes; el botón `Pagar ahora` no cobra por sí mismo y abre la captura de contacto.
- La pantalla de contacto ofrece correo electrónico o WhatsApp como canales alternativos. La prueba usó correo electrónico y no introdujo teléfono ni datos de tarjeta.
- `Enviar datos` avanza a `/web/qmx/pago-de-poliza/-/user-pago/resumen-ws`.
- La respuesta visible fue `Código: 0`, indicando que se generó y envió la liga al correo seleccionado. La página sólo mostró un acuse; no expuso una URL de pago directa.
- La prueba fue una única solicitud manual con una póliza controlada y un correo controlado. No se registran aquí el número completo, el correo, nombre, referencia ni tokens.

## Captura de red autorizada

La segunda ejecución controlada se hizo con DevTools Network y `Preserve log` activo. No se introdujeron datos de tarjeta ni se realizó un pago. Sólo se conserva la estructura redacted:

- El envío final es `POST` a `/web/qmx/pago-de-poliza` en `www.qualitas.com.mx`.
- Query string: `p_p_id`, `p_p_lifecycle=1`, `p_p_state=normal`, `p_p_mode=view`, `_pagopoliza_WAR_PagoPolizaportlet_myaction=envia-link-pago` y `p_auth` dinámico.
- El cuerpo del envío final observado en el navegador es `application/x-www-form-urlencoded`, con cuatro controles exitosos en este orden: `numTelefono`, `temail`, `tipo` y `resumenWSUrl`.
- En Email, `numTelefono` va vacío, `temail` contiene el correo seleccionado y `tipo=1`. En WhatsApp, `numTelefono` contiene el teléfono seleccionado, `temail` va vacío y `tipo=3`. `resumenWSUrl` es dinámico en ambos casos.
- Headers observados en el submit nativo de documento: `Accept`, `Accept-Language`, `Content-Type`, `Cookie`, `Origin`, `Referer`, `Sec-CH-UA*`, `Upgrade-Insecure-Requests` y `User-Agent`. No se observaron `X-Pjax` ni `X-Requested-With`.
- La respuesta observada fue `200` HTML. El acuse exitoso contiene `Código: 0`; no devuelve una URL de pago directa.
- La respuesta repetida posterior fue `Código: 99991`, `Ya se encuentra otro link de pago en curso`. Se clasifica como `UNCERTAIN` y no se reintenta.
- Se observaron cookies de sesión y de protección del proveedor; sólo se manejan en memoria por ejecución y no se guardan ni se registran. No apareció CAPTCHA ni challenge durante esta captura.
- El tiempo observado del envío final fue aproximadamente 8.8 segundos. El timeout del adaptador es acotado y configurable.

La consulta de póliza conserva la evidencia estática del formulario inicial: `POST` con acción `consulta-datos`, `numPoliza`, campos ocultos dinámicos y `p_auth` dinámico. La respuesta válida muestra los datos y recibos y un botón JavaScript `Pagar ahora`, que navega por `GET` a `/web/qmx/pago-de-poliza/-/user-pago/pago-tdc`; sólo después aparece el formulario de contacto.

## Diferencia Email vs. WhatsApp

La comparación redacted del formulario nativo mostró que ambos canales comparten la misma acción final y los campos dinámicos de sesión, pero no el mismo payload:

| Señal | Email nativo | WhatsApp nativo |
| --- | --- | --- |
| Campo `tipo` | `1` | `3` |
| `temail` | correo seleccionado | vacío |
| `numTelefono` | vacío | teléfono seleccionado |
| `resumenWSUrl` | presente | presente |
| Content-Type | `application/x-www-form-urlencoded` | `application/x-www-form-urlencoded` |
| Resultado observado | HTTP 200 con acuse `Código: 0` | redirect a `/resumen-ws` y acuse `Código: 0` |

El adaptador debe reproducir esa diferencia: `tipo=1` para Email y `tipo=3` para WhatsApp, con `URLSearchParams` y sin headers PJAX. La serialización conserva controles exitosos ordenados, duplicados y campos ocultos dinámicos. La traza registra sólo la variante, encoding, firma, cantidad de campos y presencia booleana de `tipo`, correo y teléfono, nunca sus valores.

## Estado

La implementación provisional usa `SESSION_HTTP`: obtiene el formulario inicial, conserva los campos ocultos y cookies sólo en memoria, consulta la póliza, reproduce la navegación `Pagar ahora` a `pago-tdc`, prepara el formulario de contacto y ejecuta un único envío urlencoded al endpoint observado. Sólo acepta HTTPS en `www.qualitas.com.mx`, limita redirects y tamaño de respuesta, y falla cerrada ante cambios de flujo o host.

Clasificación técnica: `SESSION_HTTP`.

Estado de release: `NOT READY`. Aún falta la certificación del SHA exacto, la validación completa con PostgreSQL descartable y confirmar en un piloto que la recepción, legitimidad de la liga y ausencia de duplicados cumplen los criterios operativos.

El flag de producción permanece `QUALITAS_PAYMENT_LINK_ENABLED=false`. No ejecutar CAPTCHA, anti-bot, autenticación ni controles de acceso.

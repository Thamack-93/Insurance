# Descubrimiento del flujo de pago Quálitas

Fecha de revisión: 2026-08-29

Este documento es la fuente única de verdad para el protocolo, la máquina de estados,
los resultados, las banderas, el diagnóstico y el piloto controlado.

## Base y ramas

La rama de trabajo `codex/qualitas-assisted-operations-reliability` parte del `main`
remoto verificado en `81215d8`. Las ramas remotas Quálitas
(`qualitas-payment-link-leading-zero`, `qualitas-payment-link-pagar-ahora` y
`qualitas-payment-link-session-http`) son ancestros de ese `main`; no hay trabajo
divergente pendiente de integrar. El ref remoto local de billing es obsoleto y también
ancestral. Se conserva el trabajo de certificación tenant y el guard de Cycle 1 ya
integrados en `main`.

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
- La respuesta repetida posterior fue `Código: 99991`, `Ya se encuentra otro link de pago en curso`. Se clasifica como `ALREADY_IN_PROGRESS`: es terminal, reconocido y no reintentable.
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

## Contrato operativo vigente

La solicitud del adaptador es `QualitasDeliveryRequest` con `policyNumber`,
`deliveryChannel` (`EMAIL` o `WHATSAPP`), `destination` y `correlationId`.
El adaptador sólo devuelve `SUCCESS`, `ALREADY_IN_PROGRESS`, `POLICY_NOT_FOUND`,
`POLICY_NOT_ELIGIBLE`, `DESTINATION_REJECTED`, `PROVIDER_FLOW_CHANGED`,
`PROVIDER_UNAVAILABLE`, `TIMEOUT_PRE_SUBMISSION`, `UNCERTAIN_POST_SUBMISSION` o
`UNEXPECTED_RESPONSE`.

La máquina de estados de Telegram es:

`COMMAND_RECEIVED` → `POLICY_RESOLUTION` → `recipient` → `channel`/`phone` →
`ready` → claim atómico `PROCESSING` → consulta de entrypoint/póliza → opcional
`Pagar ahora` → formulario de contacto → POST final → `CONFIRMED`, `FAILED` o
`UNCERTAIN`. `CANCELLED` se persiste y la expiración se determina con `expiresAt`.

El `payloadJson` versionado conserva `submissionState` (`NOT_STARTED`, `STARTED`,
`ACKNOWLEDGED`), `correlationId`, `destinationSource` (`PROFILE` o `MANUAL`),
canal y un resultado terminal sanitizado. `STARTED` se escribe inmediatamente antes
del POST final; cualquier error posterior es `UNCERTAIN_POST_SUBMISSION` y nunca se
reanuda automáticamente. El código `99991` devuelve: “Quálitas indica que ya hay
otra liga de pago en proceso para esta póliza.”

Para WhatsApp de Agente se prefiere `User.phone`. Sólo si falta se solicita un número
manual, se normaliza y enmascara, se etiqueta como capturado para esta solicitud y no
se guarda en el perfil ni en logs. Se revalida el mismo valor normalizado al confirmar.
El destinatario Cliente está detrás de `QUALITAS_PAYMENT_LINK_CLIENT_RECIPIENT_ENABLED=false`,
subordinado a `QUALITAS_PAYMENT_LINK_ENABLED`.

Toda respuesta pasa por un único clasificador: decodificación de entidades y filtro de
contenido oculto se aplican una sola vez. La traza estructurada usa el `correlationId`,
IDs internos de organización/póliza/usuario, etapa, canal, resultado, razón y duración;
el diagnóstico sólo conserva encoding, cantidad/presencia de campos y firma segura.
Nunca registra destinos, números de póliza, cookies, tokens, URLs con tokens, HTML ni
cuerpos de respuesta.

## Diagnóstico y piloto

Las fixtures estáticas se validan en Vitest. `npm run check:qualitas-flow` sólo con
`QUALITAS_FLOW_LIVE=1` hace un GET acotado y de sólo lectura al entrypoint, sin cookies
persistentes, datos de clientes ni POST final; nunca corre en CI o cron.

La certificación debe usar el SHA candidato inmutable, PostgreSQL descartable, las
comprobaciones de alcance tenant, build, drift y Release Certification. Después se
ejecutan, con autorización explícita, Agent Email, Agent WhatsApp y un duplicado
controlado. Cada piloto exige exactamente un intento intencional, recepción y liga
legítima, ningún pago, un ActivityLog seguro y traza saneada. El gate Cliente sólo se
activa después de que ambos canales de Agente y el duplicado pasen.

Estado de release: `NOT READY`. La implementación local y los fixtures no sustituyen la
certificación del SHA exacto, PostgreSQL descartable ni los pilotos manuales. Hasta que
exista esa evidencia, el release permanece `KEEP AGENT-ONLY PILOT`.

El flag de producción permanece `QUALITAS_PAYMENT_LINK_ENABLED=false`. No ejecutar CAPTCHA, anti-bot, autenticación ni controles de acceso.

## Inventario de cierre mínimo

- **Canónico:** `QualitasDeliveryRequest`, resultados canónicos, builders Email/WhatsApp,
  clasificador único y estado de sesión del draft.
- **Compatibilidad:** no se conserva compatibilidad con drafts `ready` antiguos ni con
  aliases o formas duplicadas del contrato.
- **Diagnóstico:** una sola traza terminal saneada y un único `ActivityLog`; los datos de
  destino, cookies, tokens, HTML y cuerpos de respuesta quedan fuera.
- **Obsoleto:** normalizadores legacy sin transformación, eventos de observabilidad
  paralelos y cualquier reanudación automática tras `STARTED`.
- **Sólo pruebas:** fixtures estáticos y pruebas Vitest cubren parser/builders; el script
  `check:qualitas-flow` sólo ejecuta el GET live opt-in y acotado.

## Consulta de recibos domiciliados

La consulta de recibos es un flujo aparte de la solicitud de liga. Usa la búsqueda de póliza y, si hace falta, solo la navegación GET observada a `pago-tdc`; nunca envía datos de contacto ni ejecuta el POST `envia-link-pago`. El parser solo acepta filas visibles con columnas identificables de recibo y vencimiento. Cambio de página, challenge, timeout o fechas sin correspondencia local produce `INCONCLUSIVE` y no modifica recibos.

En PolicyDesk, **Consultar portal** compara el próximo vencimiento Quálitas con recibos locales abiertos. Solo propone el primer recibo como probablemente pagado cuando la siguiente fecha del portal coincide exactamente con la segunda fecha local. El usuario debe confirmarlo para registrar el pago con método `DOMICILIATED` y fecha de consulta. Ese método se rechaza para frecuencias `ANNUAL` y `SINGLE`; no cambia la frecuencia de la póliza.

La revisión diaria requiere `QUALITAS_RECEIPT_MONITOR_ENABLED=1`, capacidad Quálitas habilitada y selección explícita en la póliza. La selección solo puede activarse después de una consulta manual concluyente en las últimas 24 horas. El barrido existente `/api/jobs/operational-followups` genera una alerta deduplicada; nunca crea pagos. Estas banderas permanecen apagadas por defecto y las tres pólizas deben validarse manualmente antes de activar la revisión diaria.

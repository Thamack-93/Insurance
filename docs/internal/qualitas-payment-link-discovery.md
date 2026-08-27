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
- El cuerpo es `multipart/form-data` generado por el navegador, con `numTelefono` vacío, `temail` y `resumenWSUrl` dinámicos.
- Headers funcionales observados: `Accept: */*`, `Origin` del mismo host, `Referer` de `/pago-tdc`, `X-Pjax: true` y `X-Requested-With: XMLHttpRequest`. El `Content-Type` incluye un boundary generado por el navegador y no se fija manualmente.
- La respuesta observada fue `200` HTML. El acuse exitoso contiene `Código: 0`; no devuelve una URL de pago directa.
- La respuesta repetida posterior fue `Código: 99991`, `Ya se encuentra otro link de pago en curso`. Se clasifica como `UNCERTAIN` y no se reintenta.
- Se observaron cookies de sesión y de protección del proveedor; sólo se manejan en memoria por ejecución y no se guardan ni se registran. No apareció CAPTCHA ni challenge durante esta captura.
- El tiempo observado del envío final fue aproximadamente 8.8 segundos. El timeout del adaptador es acotado y configurable.

La consulta de póliza conserva la evidencia estática del formulario inicial: `POST` con acción `consulta-datos`, `numPoliza`, campos ocultos dinámicos y `p_auth` dinámico. La respuesta válida muestra los datos y recibos y un botón JavaScript `Pagar ahora`, que navega por `GET` a `/web/qmx/pago-de-poliza/-/user-pago/pago-tdc`; sólo después aparece el formulario de contacto.

## Estado

La implementación provisional usa `SESSION_HTTP`: obtiene el formulario inicial, conserva los campos ocultos y cookies sólo en memoria, consulta la póliza, reproduce la navegación `Pagar ahora` a `pago-tdc`, prepara el formulario de contacto y ejecuta un único envío multipart al endpoint observado. Sólo acepta HTTPS en `www.qualitas.com.mx`, limita redirects y tamaño de respuesta, y falla cerrada ante cambios de flujo o host.

Clasificación técnica: `SESSION_HTTP`.

Estado de release: `NOT READY`. Aún falta la certificación del SHA exacto, la validación completa con PostgreSQL descartable y confirmar en un piloto que la recepción, legitimidad de la liga y ausencia de duplicados cumplen los criterios operativos.

El flag de producción permanece `QUALITAS_PAYMENT_LINK_ENABLED=false`. No ejecutar CAPTCHA, anti-bot, autenticación ni controles de acceso.

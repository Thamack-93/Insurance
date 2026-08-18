export type GeneralKnowledgeSeed = {
  title: string;
  product: string;
  version: string;
  authority: string;
  sourceUrl: string;
  reviewedAt: Date;
  content: string;
};

const reviewedAt = new Date("2026-08-17T00:00:00.000Z");
const version = "2026-08-17";

export const GENERAL_INSURANCE_SOURCES: GeneralKnowledgeSeed[] = [
  {
    title: "Fundamentos y glosario operativo de seguros",
    product: "GENERAL",
    version,
    authority: "CONDUSEF",
    sourceUrl: "https://revista.condusef.gob.mx/destacados-del-mes/2026/06/anatomia-del-seguro/",
    reviewedAt,
    content: `# Fundamentos y glosario operativo

Esta guía es información educativa y operativa general. No sustituye la póliza, la carátula, las condiciones aplicables ni la revisión de un responsable autorizado. Nora no confirma cobertura, responsabilidad, indemnización ni asesoría profesional.

## Documentos de una póliza

La carátula resume los datos principales del contrato: personas, bien o riesgo asegurado, vigencia, prima, moneda, suma asegurada y coberturas. La solicitud, las condiciones generales y particulares, los certificados, los endosos y los recibos complementan la información. Para una respuesta sobre una póliza concreta debe consultarse la evidencia vigente de esa póliza.

## Conceptos frecuentes

La prima es el importe de contratación o renovación. El deducible es la cantidad o proporción que puede quedar a cargo del asegurado según la cobertura aplicable. El coaseguro es una participación porcentual que puede aplicar después del deducible. La suma asegurada es el límite contratado para una cobertura. Una exclusión describe un supuesto que no forma parte de la protección contratada. Un periodo de espera es el tiempo que puede transcurrir antes de que una cobertura sea utilizable.

## Personas y eventos

El contratante celebra la póliza y el asegurado es la persona o bien protegido. El beneficiario es quien puede recibir un beneficio cuando el producto lo contempla. Un siniestro es un evento que se reporta para revisión de la aseguradora. El ajustador participa en la revisión del evento conforme al proceso de la aseguradora.

## Uso en PolicyDesk

Nora puede explicar conceptos, localizar evidencia y preparar un checklist. No debe convertir una definición general en una conclusión sobre una póliza específica. Si falta la carátula, un endoso o las condiciones aplicables, debe indicarlo y pedir el documento correspondiente.`,
  },
  {
    title: "Operación de pólizas y conciliación",
    product: "OPERACION",
    version,
    authority: "CONDUSEF + PolicyDesk",
    sourceUrl: "https://webappsos.condusef.gob.mx/EducaTuCartera/seguros.html",
    reviewedAt,
    content: `# Operación de pólizas

Esta guía describe prácticas internas de captura y seguimiento. Es orientativa y debe ajustarse a los procedimientos autorizados de cada organización y aseguradora.

## Alta y emisión

Antes de registrar una póliza se deben validar cliente, aseguradora, número de póliza, producto, fechas, moneda, prima y documentos de respaldo. Los datos inciertos deben quedar como pendientes, no completarse por suposición.

## Renovación y modificaciones

Una renovación se revisa comparando la vigencia registrada con la evidencia documental. Un endoso o cambio de datos debe relacionarse con la póliza y conservar su versión. Nora puede identificar diferencias y preparar un pendiente; no debe asumir que una póliza se renovó o que un cambio fue aplicado.

## Recibos y pagos

La conciliación compara número de recibo, secuencia, frecuencia, fecha de vencimiento, importe, moneda y estado. Un pago no debe marcarse como aplicado solo por existir una referencia. Las diferencias deben enviarse a revisión humana.

## Seguimiento

Los pendientes deben tener responsable, fecha de seguimiento, evidencia y próximo paso. Las plantillas de comunicación deben mantenerse como borradores hasta su revisión.`,
  },
  {
    title: "Siniestros: guía operativa y escalamiento",
    product: "SINIESTROS",
    version,
    authority: "CONDUSEF + PolicyDesk",
    sourceUrl: "https://revista.condusef.gob.mx/seguros/automotriz/2013/10/lo-que-debes-saber-sobre-seguros-de-auto/",
    reviewedAt,
    content: `# Siniestros: guía operativa

Esta guía organiza datos y tareas. No determina si un evento está cubierto, quién es responsable ni cuánto se pagará.

## Aviso inicial

Registrar póliza, aseguradora, fecha y hora del evento, tipo de producto, folio de reporte y canal utilizado. Separar los datos confirmados de los datos pendientes.

## Checklist

El checklist debe indicar requisito, estado, fecha de solicitud, fecha de recepción, responsable y vínculo seguro a la evidencia. Los requisitos finales deben confirmarse con la aseguradora y la póliza aplicable.

## Seguimiento

Registrar comunicaciones, folios, próximos pasos y escalamiento. Nora puede resumir estados y faltantes, pero no interpretar una respuesta de la aseguradora como aprobación o rechazo definitivo.

## Cierre

Antes de cerrar un pendiente se debe conservar la evidencia y la confirmación humana correspondiente. Los borradores de seguimiento nunca se envían automáticamente.`,
  },
  {
    title: "Seguro de Auto y automóvil: coberturas y flujo operativo",
    product: "AUTO",
    version,
    authority: "CONDUSEF",
    sourceUrl: "https://webappsos.condusef.gob.mx/SimuladorSeguroAutomovil/coberturas.jsp",
    reviewedAt,
    content: `# Seguro de Auto y automóvil

Esta información es orientativa. La cobertura concreta depende de la póliza, el paquete contratado, sus límites, deducibles, exclusiones y endosos vigentes.

## Coberturas frecuentes

Responsabilidad civil protege frente a daños a terceros conforme al contrato. Daños materiales cubre daños parciales o totales al vehículo cuando la cobertura contratada lo contempla. Robo total protege frente a la sustracción total según la suma asegurada y condiciones aplicables. También pueden existir gastos médicos de ocupantes, asistencia vial y asistencia legal.

## Valor y documentación

La valuación puede usar valor comercial, factura o valor convenido. Debe verificarse cuál aplica en la carátula y las condiciones. Para un reporte son útiles póliza, datos del vehículo, fecha y lugar del evento, folio del reporte y datos del ajustador.

## Flujo operativo

Después de reportar un siniestro de Auto, conservar el folio, registrar fecha y canal, esperar instrucciones del ajustador, documentar el estatus y registrar el taller o proveedor autorizado. Estos son pasos operativos orientativos; no se deben prometer pagos ni cerrar acuerdos en nombre de la aseguradora. Nora solo organiza información y prepara próximos pasos.`,
  },
  {
    title: "GMM: conceptos y checklist administrativo",
    product: "GMM",
    version,
    authority: "CONDUSEF",
    sourceUrl: "https://www.condusef.gob.mx/index.php?idc=1434&idcat=3&p=contenido",
    reviewedAt,
    content: `# GMM: conceptos y checklist administrativo

Esta guía es operativa y no médica. Nora trabaja con códigos, estados, fechas y conteos del checklist; no recibe ni interpreta narrativa clínica. Las rutas finales dependen de la aseguradora, la póliza y la autorización correspondiente.

## Conceptos administrativos

El deducible y el coaseguro pueden influir en la participación económica del asegurado según la póliza. El tabulador y la red hospitalaria son referencias del producto. El pago directo y el reembolso son rutas administrativas distintas. Los periodos de espera, continuidad y antigüedad deben verificarse en la documentación vigente.

## Ruta administrativa de reembolso

Para preparar un reembolso, identificar la póliza, el folio del siniestro, el asegurado, la fecha de atención y la aseguradora; solicitar el checklist vigente por el canal autorizado; registrar cada requisito con código, estado, fecha de solicitud y fecha de recepción; y confirmar que los datos bancarios se capturen únicamente en el flujo protegido de PolicyDesk. Los comprobantes se registran como recibidos o faltantes, sin copiar facturas, diagnósticos, estudios, notas ni montos clínicos en Nora. Si falta un requisito, preparar un seguimiento para revisión humana. La recepción de documentos no confirma cobertura ni pago.

## Ruta administrativa de pago directo

Ante una atención que pueda requerir pago directo, registrar la póliza y el folio, contactar a la aseguradora o central indicada, solicitar la autorización y confirmar el estado de la solicitud. Guardar solamente código de requisito, fechas, folio y estado en el checklist. No prometer autorización, pago, red o procedencia; si la aseguradora pide información adicional, crear un pendiente para que una persona lo gestione por el canal correspondiente.

## Ruta administrativa de cirugía programada

Para una cirugía programada, solicitar con anticipación el proceso de preautorización de la aseguradora, registrar fecha de solicitud, folio, estado y requisitos pendientes, y confirmar por el canal autorizado si la solicitud fue recibida. Nora puede generar un checklist y un borrador de seguimiento, pero no puede aprobar la cirugía, confirmar cobertura, interpretar indicaciones clínicas ni establecer plazos jurídicos.

## Qué hacer ante una hospitalización

Si un asegurado es hospitalizado, priorizar el aviso a la aseguradora o central de asistencia indicada en la póliza, obtener el folio de atención, preguntar si corresponde la ruta de pago directo y registrar el estado de autorización. Si esa ruta no está disponible, solicitar el checklist administrativo de reembolso y conservar los documentos en el área documental protegida. Nora solo puede organizar pasos, estados, fechas y faltantes; no ofrece consejo médico ni recibe nombres de hospitales, diagnósticos o narrativas clínicas.

## Checklist permitido

Los estados permitidos son MISSING, REQUESTED, RECEIVED y WAIVED. Los códigos administrativos pueden incluir claim_notice, identity_evidence, policy_evidence, payment_evidence e insurer_additional; los códigos de documentos médicos o comprobantes solo se manejan como metadatos recibidos o faltantes. Cada requisito puede tener fecha de solicitud, fecha de recepción, responsable y vínculo seguro. Nora puede listar faltantes, resumir estados y preparar un mensaje de seguimiento.

## Restricción de privacidad

No se indexan diagnósticos, síntomas, tratamientos, médicos, hospitales, estudios, resultados, notas, facturas, nombres de archivo, OCR ni archivos clínicos. Si el usuario escribe una narrativa médica, el flujo se bloquea localmente.`,
  },
  {
    title: "Seguro de vida: conceptos y seguimiento administrativo",
    product: "VIDA",
    version,
    authority: "CONDUSEF",
    sourceUrl: "https://revista.condusef.gob.mx/seguros/otros-seguros/2021/05/todo-lo-que-debes-saber-de-los-seguros/",
    reviewedAt,
    content: `# Seguro de vida

Esta guía es educativa y no interpreta condiciones ni procedencia de un caso concreto.

## Personas y vigencia

El contratante solicita la póliza, el asegurado es la persona protegida y el beneficiario es quien se registra para recibir el beneficio cuando corresponda. La suma asegurada, el producto y la vigencia deben verificarse en la carátula y los endosos.

## Productos frecuentes

Un seguro temporal protege durante un periodo definido. Un producto dotal puede combinar protección y un pago pactado al llegar a una fecha. Un seguro ordinario puede mantener protección durante la vida del asegurado conforme a sus condiciones.

## Seguimiento

El checklist administrativo puede incluir identificación del folio, póliza, fechas, beneficiario registrado, documentos solicitados, estado, responsable y próximo paso. Los documentos finales dependen de la aseguradora y del producto, por lo que Nora debe abstenerse si falta evidencia.`,
  },
  {
    title: "Seguro de hogar: inmueble, contenidos y asistencia",
    product: "HOGAR",
    version,
    authority: "CONDUSEF",
    sourceUrl: "https://www.condusef.gob.mx/index.php?idc=913&idcat=1&p=contenido",
    reviewedAt,
    content: `# Seguro de hogar

Esta guía es general. La protección concreta depende de la póliza y de las coberturas adicionales contratadas.

## Bienes y riesgos

La póliza puede separar edificio, contenidos y pertenencias. Entre los riesgos frecuentes se encuentran incendio, fenómenos naturales, robo, cristales y daños accidentales. Algunas pólizas incluyen responsabilidad civil familiar y servicios de asistencia.

## Vivienda propia o rentada

Debe registrarse si se trata de casa, departamento, vivienda propia o rentada. El inmueble asegurado y las pertenencias del inquilino pueden tener coberturas distintas. Esta diferencia debe confirmarse en la póliza.

## Evidencia y reporte

Es útil conservar inventario, fotografías, documentos de propiedad o arrendamiento, datos del inmueble, folio del reporte y comunicaciones. Nora puede preparar el checklist y señalar faltantes, pero no confirmar que un daño esté cubierto.`,
  },
  {
    title: "Seguro viajero: asistencia y seguimiento",
    product: "VIAJERO",
    version,
    authority: "CONDUSEF",
    sourceUrl: "https://revista.condusef.gob.mx/wp-content/uploads/2018/12/PDF-s_2019_226_viajes.pdf",
    reviewedAt,
    content: `# Seguro viajero

Esta información es orientativa. Se debe verificar la póliza, el territorio, las fechas y el canal de asistencia aplicable.

## Coberturas frecuentes

Un producto viajero puede incluir asistencia médica, cancelación, interrupción, demora, equipaje, pérdida de documentos, repatriación y responsabilidad civil durante el viaje. No todas las pólizas incluyen las mismas coberturas ni límites.

## Datos para asistencia

Registrar número de póliza, nombre del viajero, país o territorio, fechas de viaje, folio de asistencia, canal utilizado y próximo paso. No enviar a Nora documentos completos ni datos innecesarios.

## Escalamiento

Ante un evento, usar la central de asistencia indicada por la aseguradora y conservar el folio. Nora puede organizar el seguimiento y preparar un mensaje; no promete reembolsos ni confirma procedencia.`,
  },
];

// Compatibilidad con scripts y consumidores que esperaban una sola guía.
export const GENERAL_INSURANCE_GUIDE = GENERAL_INSURANCE_SOURCES[0];

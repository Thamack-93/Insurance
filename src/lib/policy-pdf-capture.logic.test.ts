import { describe, expect, it, vi } from "vitest";
import {
  buildPolicyPdfCaptureFieldConfidence,
  extractPolicyPdfDraftFromText,
  inferClientType,
  normalizePdfPaymentFrequencyLabel,
  extractPolicyPdfReceiptEvidence,
  scoreCaptureIdentity,
  suggestPreviousPolicyNumber,
} from "@/lib/policy-pdf-capture.shared";
import { buildPolicyPdfCapturePreviewFromDraft, buildPolicyPdfCapturePreviewFromText } from "@/lib/policy-pdf-capture-preview";

vi.mock("server-only", () => ({}));

describe("policy-pdf-capture", () => {
  it("suggests the prior renewal policy number", () => {
    expect(suggestPreviousPolicyNumber("19941U01")).toBe("19941U00");
    expect(suggestPreviousPolicyNumber("ABC123")).toBeNull();
  });

  it("matches legal suffixes, punctuation and accents without confusing insurers", () => {
    expect(scoreCaptureIdentity("MOTORES ANGELOPOLIS, S.A. DE C.V.", "MOTORES ANGELOPOLIS SA DE CV")).toBe(100);
    expect(scoreCaptureIdentity("Seguros Banorte, S.A. de C.V.", "Seguros Banorte")).toBe(100);
    expect(scoreCaptureIdentity("Seguros Banorte, S.A. de C.V.", "BUPA MÉXICO, COMPAÑÍA DE SEGUROS")).toBe(0);
  });

  it("normalizes payment frequency labels to readable Spanish", () => {
    expect(normalizePdfPaymentFrequencyLabel("Anual")).toBe("Anual");
    expect(normalizePdfPaymentFrequencyLabel("ANNUAL")).toBe("Anual");
    expect(normalizePdfPaymentFrequencyLabel("Mensual")).toBe("Mensual");
  });

  it("extracts the core renewal fields from the PDF text layout", () => {
    const text = `
      AXA Seguros, S.A. de C.V.
      Póliza 19941U01
      Asegurado titular
      ARELLANO REGINO, ADRIAN YOSEF
      Vigencia 28/05/2026 al 28/05/2027
      Fecha de emisión 22/04/2026
      Frecuencia Anual
      Plan de pago Flex Plus
      Prima anual total $30,266.88
      Solicitud 000013938707
      GMM
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyNumber).toBe("19941U01");
    expect(draft.clientName).toBe("ARELLANO REGINO, ADRIAN YOSEF");
    expect(draft.clientType).toBe("PERSON");
    expect(draft.insurerName).toBe("AXA Seguros, S.A. de C.V.");
    expect(draft.policyType).toBe("GMM");
    expect(draft.startDate).toBe("2026-05-28");
    expect(draft.endDate).toBe("2027-05-28");
    expect(draft.issueDate).toBe("2026-04-22");
    expect(draft.paymentFrequency).toBe("ANNUAL");
    expect(draft.paymentPlan).toBe("Flex Plus");
    expect(draft.premiumAmount).toBeCloseTo(30266.88);
    expect(draft.requestNumber).toBe("000013938707");
    expect(draft.clientRfc).toBeNull();
    expect(draft.insuredObject).toBeNull();
    expect(draft.beneficiaryInfo).toBeNull();
    expect(draft.sourcePolicyNumber).toBe("19941U00");
  });

  it("infers company clients when RFC and company signals are present", () => {
    expect(inferClientType("Maria Fernanda Corral Morales Escuela", "COMF950403J13")).toBe("COMPANY");
    expect(inferClientType("Maria Fernanda Corral Morales", null)).toBe("PERSON");
  });

  it("cleans the client name when the RFC appears on the same line", () => {
    const draft = extractPolicyPdfDraftFromText(`
      50702000466
      Maria Fernanda Corral Morales Registro Federal de Contribuyentes: COMF950403J13
      Giro de la empresa/ Actividades preponderantes: Escuela
      Domicilio Calle: Calle Emiliano Zapata, 8
      Estado: Tlaxcala
      Colonia: Centro
      Código Postal: 90600
      Alcaldía/ Municipio: Apetatitlán De Antonio Carvajal
      Teléfono:
      Tipo de seguro: Accidentes Personales
      Vigencia 31/01/2026 al 03/03/2026
      Prima $28
    `);

    expect(draft.clientName).toBe("Maria Fernanda Corral Morales");
    expect(draft.clientRfc).toBe("COMF950403J13");
    expect(draft.clientType).toBe("COMPANY");
    expect(draft.clientAddress).toContain("Calle Emiliano Zapata");
  });

  it("ignores Quálitas boilerplate and keeps the insured block on a real Pedro policy", () => {
    const text = `
      PLAN: AMPLIA
      PÓLIZA ENDOSO INCISO
      PÓLIZA DE SEGURO DE AUTOMÓVILES
      0940424986 000000 0001
      INFORMACIÓN DEL ASEGURADO
      PEDRO ALFREDO GOMEZ LORENZO
      4117 (I)BUICK ENVISION CXL N 5P L4 2.0L AWD VP BA QC 3 AC AUT.
      Vigencia Desde las 12:00 P.M. del: 23/SEP/2025 Hasta las 12:00 P.M. del: 23/SEP/2026
      INFORMACIÓN IMPORTANTE
      Estimado Asegurado Quálitas Compañía de Seguros, lo invita a que lea sus Condiciones Generales con la finalidad de
      que conozca los alcances, exclusiones y restricciones con que cuenta el seguro de automóvil que acaba de adquirir.
      Independientemente de la obligación a cargo de la Compañía de hacer entrega de las Condiciones Generales por el medio
      que usted haya elegido en la solicitud de seguro, la consulta de dicha Documentación puede ser efectuada en la página
      Web: https://www.qualitas.com.mx/web/qmx/conoce-todas-las-condiciones-generales o en el RECAS.
      Usted puede consultar el folleto que contiene los Derechos de los Asegurados, Contratantes y Beneficiarios en nuestra
      página de internet (www.qualitas.com.mx), lo anterior con independencia de la entrega física que Quálitas Compañía de
      Seguros tiene obligación de efectuar de manera directa o bien a través de la persona física o moral que participe en la
      intermediación o contratación de este seguro.
      Artículo 25 de la Ley sobre el Contrato de Seguro. Si el contenido de la póliza o sus modificaciones no concordaren con
      la oferta, el Asegurado podrá pedir la rectificación correspondiente dentro de los treinta (30) días que sigan al día en
      que reciba su póliza, transcurrido ese plazo se considerán aceptadas las estipulaciones de la póliza o de
      sus modificaciones.
      Nuestra Unidad Especializada de Atención a Usuario (UNE) con siguiente domicilio en: Boulevard Picacho Ajusco 236
      Colonia Jardines de la Montaña, Alcaldía Tlalpan, Ciudad de México, C.P. 14210, horario de atención de
      Lunes a Viernes de 9:00 a.m. a 6:00 p.m., teléfono (55) 5002 5500 , correo electrónico: uauf@quialitas.com.mx
      Quálitas Compañía de Seguros, S.A. de C.V. con domicilio en Av. San Jerónimo #478, Colonia Jardines del Pedregal,
      Delegación Álvaro Obregón, C.P. 01900, Ciudad de México tratará sus Datos Personales de acuerdo a las siguientes
      finalidades: administración, mantenimiento o renovación de la póliza de seguro, así como los fines relacionados con el
      cumplimiento de nuestras obligaciones que deriven de la Ley sobre el Contrato de Seguro y de la normatividad aplicable,
      se encuentra a su disposición el Aviso de Privacidad Integral en www.qualitas.com.mx
      RENUEVA A: 0940394284
      PLAN: AMPLIA
      PÓLIZA ENDOSO INCISO
      PÓLIZA DE SEGURO DE AUTOMÓVILES
      0940424986 000000 0001
      INFORMACIÓN DEL ASEGURADO
      PEDRO ALFREDO GOMEZ LORENZO
      Domicilio: CALLE 3 No. EXT. 1 No. INT. R.F.C.: GOLP930818E95
      C.P.:72190 Municipio: PUEBLA Estado: PUEBLA Colonia: SAN JOSE VISTA HERM
      DESCRIPCIÓN DEL VEHÍCULO ASEGURADO
      BUICK ENVISION CXL N 5P L4 2.0L AWD VP BA QC 3 AC AUT.
      Serie: LRBFX8SX3JD026485
      Vigencia Desde las 12:00 P.M. del:23/SEP/2025 07/OCT/2025 Servicio:PARTICULAR
      Hasta las 12:00 P.M. del:23/SEP/2026 Plazo de pago: 14 dias Movimiento:ALTA
      Forma de: CONTADO Pago Unico 12,281.81 Gastos por Expedición. 640.00
      IMPORTE TOTAL 12,281.81
      Condiciones generales aplicables QJ/01 1224-GA A 12 DE AGOSTO DE 2025
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyNumber).toBe("0940424986");
    expect(draft.clientName).toBe("PEDRO ALFREDO GOMEZ LORENZO");
    expect(draft.insurerName).toBe("Quálitas Compañía de Seguros");
    expect(draft.clientPhone).toBeNull();
    expect(draft.clientEmail).toBeNull();
    expect(draft.clientAddress).toContain("CALLE 3 No. EXT. 1 No. INT.");
    expect(draft.sourcePolicyNumber).toBe("0940394284");
    expect(draft.premiumAmount).toBeCloseTo(12281.81);
  });

  it("normalizes plan solicitud headers to GMM", () => {
    const text = `
      AXA Seguros
      Póliza 19941U01
      Ramo DE PLAN SOLICITUD
      Asegurado titular
      ARELLANO REGINO, ADRIAN YOSEF
      Vigencia 28/05/2026 al 28/05/2027
      Prima anual total $30,266.88
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyType).toBe("GMM");
  });

  it("extracts the automobile capture fields including serial number", () => {
    const text = `
      PÓLIZA DE SEGURO DE AUTOMÓVILES
      0940451814 000000 0001
      INFORMACIÓN DEL ASEGURADO
      CHARBEL SALOMON MURAD KOPPEL
      DESCRIPCIÓN DEL VEHÍCULO ASEGURADO
      09211 JEEP GRAND CHEROKEE LIMITED LUJO 5P V6 3.6L VP TPA. AUT.
      Tipo: Automoviles Importados Modelo: 2019 Ocupantes: 05
      Serie: 1C4RJEBG3KC602887 Motor: HECHO EN USA Color: Placas: SN
      Vigencia Desde las 12:00 P.M. del 27/MAY/2026 Hasta las 12:00 P.M. del 27/MAY/2027
      Forma de Pago: SEMESTRAL
      IMPORTE TOTAL. 14,324.39
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyNumber).toBe("0940451814");
    expect(draft.clientName).toBe("CHARBEL SALOMON MURAD KOPPEL");
    expect(draft.policyType).toBe("AUTO");
    expect(draft.serialNumber).toBe("1C4RJEBG3KC602887");
    expect(draft.insuredObject).toContain("JEEP GRAND CHEROKEE");
    expect(draft.startDate).toBe("2026-05-27");
    expect(draft.endDate).toBe("2027-05-27");
    expect(draft.paymentFrequency).toBe("SEMIANNUAL");
    expect(draft.premiumAmount).toBeCloseTo(14324.39);
    expect(draft.requestNumber).toBeNull();
    expect(draft.sourcePolicyNumber).toBeNull();
  });

  it("prioritizes the Quálitas policy block over the CONDUSEF registry and reads receipt evidence", () => {
    const coverText = `
      Quálitas Compañía de Seguros, S.A. de C.V.
      RENUEVA A: 0940424458
      PÓLIZA ENDOSO INCISO
      PÓLIZA DE SEGURO DE AUTOMÓVILES
      0940457241 000000 0001
      CONDUSEF-002429-22
      INFORMACIÓN DEL ASEGURADO
      INES BARRADAS ALARCON
      Serie: YJU787B3VVHP65N5NM156546
      Vigencia Desde las 12:00 P.M. del: 16/AGO/2026 Hasta las 12:00 P.M. del: 16/AGO/2027
      IMPORTE TOTAL 6,359.33
    `;
    const draft = extractPolicyPdfDraftFromText(coverText);
    expect(draft.policyNumber).toBe("0940457241");
    expect(draft.sourcePolicyNumber).toBe("0940424458");
    expect(draft.clientName).toBe("INES BARRADAS ALARCON");
    expect(draft.serialNumber).toBe("YJU787B3VVHP65N5NM156546");

    const receipt = extractPolicyPdfReceiptEvidence(`
      AVISO DE COBRO
      Póliza 0940457241
      Número control 0307563244
      Fecha de vencimiento 30/08/2026
      Serie 01/01
      Total a pagar $6,359.33
      FICHA DE DEPOSITO
      Total a pagar $6,359.00
      Forma de pago CONTADO
    `);
    expect(receipt).toMatchObject({ policyNumber: "0940457241", receiptControlNumber: "0307563244", dueDate: "2026-08-30", periodLabel: "01/01", amountDue: 6359.33, depositAmount: 6359, paymentConfirmed: false });
    expect(receipt?.warnings.join(" ")).toContain("6359.33");
  });

  it("extracts the Banorte cover page without mistaking its phone or URL for policy data", () => {
    const draft = extractPolicyPdfDraftFromText(`
      8008371133
      www.segurosbanorte.com.mx
      SEGUROS BANORTE
      DATOS DEL ASEGURADO
      Nombre del Contratante: MOTORES ANGELOPOLIS, S.A. DE C.V. R.F.C.: MAGD900101AB1
      Calle y No.: VIA ATLIXCAYOTL NO.3202 1
      C.P.: 72840 Estado: PUEBLA Teléfono: (222)-4038925
      DATOS DE LA PÓLIZA
      No. de Póliza
      1009578 0 986 70 01 1
      Fecha de emisión: 01/AGO/2026
      Inicio Vigencia:
      12:00 hrs 01/AGO/2026
      Fin Vigencia:
      12:00 hrs 01/AGO/2027
      Descripción del vehículo asegurado
      CHEVROLET DEMO SEDAN AUT.
      Serie: 1G1F66S0XN4124102
      Prima Total: $31,920.29
    `);

    expect(draft.policyNumber).toBe("1009578");
    expect(draft.clientName).toBe("MOTORES ANGELOPOLIS, S.A. DE C.V.");
    expect(draft.clientType).toBe("COMPANY");
    expect(draft.clientRfc).toBe("MAGD900101AB1");
    expect(draft.clientAddress).toContain("VIA ATLIXCAYOTL NO.3202");
    expect(draft.clientAddress).not.toContain("4038925");
    expect(draft.clientPhone).toBe("(222)-4038925");
    expect(draft.insurerName).toBe("Seguros Banorte, S.A. de C.V.");
    expect(draft.policyType).toBe("AUTO");
    expect(draft.startDate).toBe("2026-08-01");
    expect(draft.endDate).toBe("2027-08-01");
    expect(draft.issueDate).toBe("2026-08-01");
    expect(draft.premiumAmount).toBeCloseTo(31920.29);
    expect(draft.serialNumber).toBe("1G1F66S0XN4124102");
  });

  it("keeps request numbers, policy numbers, and insurer labels separate across a generic layout", () => {
    const draft = extractPolicyPdfDraftFromText(`
      Centro de atención: 800-555-0101
      No. de Solicitud
      40583993
      Aseguradora
      www.example-insurer.test
      Compañía: Seguros Delta, S.A. de C.V.
      Asegurado: CARLOS DEMO PEREZ
      No. de Póliza: 1234567
      Inicio de vigencia:
      01/09/2026
      Fin de vigencia:
      01/09/2027
      Prima total: $12,345.67
    `);

    expect(draft.requestNumber).toBe("40583993");
    expect(draft.policyNumber).toBe("1234567");
    expect(draft.clientName).toBe("CARLOS DEMO PEREZ");
    expect(draft.insurerName).toBe("Seguros Delta, S.A. de C.V.");
    expect(draft.startDate).toBe("2026-09-01");
    expect(draft.endDate).toBe("2027-09-01");
    expect(draft.premiumAmount).toBeCloseTo(12345.67);
  });

  it("extracts the real Buick renewal fields from the provided PDF layout", () => {
    const text = `
      Quálitas Compañía de Seguros, S.A. de C.V.
      RENUEVA A: 0940400640
      PLAN: AMPLIA
      PÓLIZA ENDOSO INCISO
      PÓLIZA DE SEGURO DE AUTOMÓVILES
      0940434491 000000 0001
      INFORMACIÓN DEL ASEGURADO
      HANE TANUS CABALLERO
      Domicilio: AZABACHE No. EXT. 8 No. INT. R.F.C.: TACH930318FA8
      C.P.:72700 Municipio: CUAUTLANCINGO Estado: PUEBLA Colonia: LA JOYA
      DESCRIPCIÓN DEL VEHÍCULO ASEGURADO
      BUICK ENCORE LEATHERETTE N 5P L4 1.4L TURBO ABS BA AUT. Automoviles Importados 2016
      Serie: KL4CJ9EB3GB630788
      Vigencia Desde las 12:00 P.M. del:15/DIC/2025 29/DIC/2025 Servicio:PARTICULAR
      Hasta las 12:00 P.M. del:15/DIC/2026 Plazo de pago: 14 dias Movimiento:ALTA
      Forma de: CONTADO Pago Unico 10,077.59 Gastos por Expedición. 640.00
      IMPORTE TOTAL 10,077.59
      Condiciones generales aplicables QJ/01 1025-HA A 22 DE NOVIEMBRE DE 2025
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyNumber).toBe("0940434491");
    expect(draft.clientName).toBe("HANE TANUS CABALLERO");
    expect(draft.clientType).toBe("PERSON");
    expect(draft.clientRfc).toBe("TACH930318FA8");
    expect(draft.clientAddress).toContain("AZABACHE No. EXT. 8");
    expect(draft.insurerName).toBe("Quálitas Compañía de Seguros");
    expect(draft.policyType).toBe("AUTO");
    expect(draft.serialNumber).toBe("KL4CJ9EB3GB630788");
    expect(draft.startDate).toBe("2025-12-15");
    expect(draft.endDate).toBe("2026-12-15");
    expect(draft.issueDate).toBe("2025-11-22");
    expect(draft.paymentFrequency).toBe("ANNUAL");
    expect(draft.premiumAmount).toBeCloseTo(10077.59);
    expect(draft.requestNumber).toBeNull();
    expect(draft.sourcePolicyNumber).toBe("0940400640");
    expect(draft.insuredObject).toContain("BUICK ENCORE");
  });

  it.each([
    {
      name: "Pedro",
      text: `
        RENUEVA A: 0940394284
        PLAN: AMPLIA
        PÓLIZA ENDOSO INCISO
        PÓLIZA DE SEGURO DE AUTOMÓVILES
        0940424986 000000 0001
        INFORMACIÓN DEL ASEGURADO
        PEDRO ALFREDO GOMEZ LORENZO
        Domicilio: CALLE 3 No. EXT. 1 No. INT. R.F.C.: GOLP930818E95
        C.P.:72190 Municipio: PUEBLA Estado: PUEBLA Colonia: SAN JOSE VISTA HERM
        DESCRIPCIÓN DEL VEHÍCULO ASEGURADO
        BUICK ENVISION CXL N 5P L4 2.0L AWD VP BA QC 3 AC AUT.
        Serie: LRBFX8SX3JD026485
        Vigencia Desde las 12:00 P.M. del:23/SEP/2025 07/OCT/2025 Servicio:PARTICULAR
        Hasta las 12:00 P.M. del:23/SEP/2026 Plazo de pago: 14 dias Movimiento:ALTA
        Forma de: CONTADO Pago Unico 12,281.81 Gastos por Expedición. 640.00
        IMPORTE TOTAL 12,281.81
        Condiciones generales aplicables QJ/01 1224-GA A 12 DE AGOSTO DE 2025
      `,
      expected: {
        policyNumber: "0940424986",
        clientName: "PEDRO ALFREDO GOMEZ LORENZO",
        clientRfc: "GOLP930818E95",
        clientAddress: "CALLE 3 No. EXT. 1 No. INT.",
        serialNumber: "LRBFX8SX3JD026485",
        startDate: "2025-09-23",
        endDate: "2026-09-23",
        issueDate: "2025-08-12",
        paymentFrequency: "ANNUAL",
        premiumAmount: 12281.81,
        sourcePolicyNumber: "0940394284",
      },
    },
    {
      name: "Sandra",
      text: `
        RENUEVA A: 0940405550
        PLAN: AMPLIA
        PÓLIZA ENDOSO INCISO
        PÓLIZA DE SEGURO DE AUTOMÓVILES
        0940440951 000000 0001
        INFORMACIÓN DEL ASEGURADO
        SANDRA HADDAD APORTELA
        Domicilio: AV. 27 SUR 2908 Número: 1 Interior: 1 R.F.C.: HAAS900217TK4
        C.P.:72410 Municipio: PUEBLA Estado: PUEBLA Colonia: JUAREZ
        DESCRIPCIÓN DEL VEHÍCULO ASEGURADO
        BMW X2 SDRIVE18IA EXECUTIVE 5P L3 1.5L. AUT.
        Serie: WBAYH1101L5N99155
        Vigencia Desde las 12:00 P.M. del 14/FEB/2026 Hasta las 12:00 P.M. del 14/FEB/2027
        CONTADO Gastos por Expedición 640.00
        IMPORTE TOTAL. 16,303.48
        Condiciones Generales aplicables (QJ/01 1025-HA) A 30 DE ENERO DE 2026
      `,
      expected: {
        policyNumber: "0940440951",
        clientName: "SANDRA HADDAD APORTELA",
        clientRfc: "HAAS900217TK4",
        clientAddress: "AV. 27 SUR 2908 Número: 1 Interior: 1 C.P. 72410 Municipio PUEBLA Estado PUEBLA Colonia JUAREZ",
        serialNumber: "WBAYH1101L5N99155",
        startDate: "2026-02-14",
        endDate: "2027-02-14",
        issueDate: "2026-01-30",
        paymentFrequency: "ANNUAL",
        premiumAmount: 16303.48,
        sourcePolicyNumber: "0940405550",
      },
    },
    {
      name: "Paulina",
      text: `
        RENUEVA A: 0940392912
        PLAN: AMPLIA
        PÓLIZA ENDOSO INCISO
        PÓLIZA DE SEGURO DE AUTOMÓVILES
        0940426625 000000 0001
        INFORMACIÓN DEL ASEGURADO
        PAULINA GONZALEZ GARIBAY
        Domicilio: BOULEVARD 5 DE MAYO No. EXT. 4231 No. INT. 1 R.F.C.: GOGP930917CX3
        C.P.:72534 Municipio: PUEBLA Estado: PUEBLA Colonia: HUEXOTITLA
        DESCRIPCIÓN DEL VEHÍCULO ASEGURADO
        MAZDA 2 I TOURING 4P L4 1.5L ABS BA AC R15 SKYACTI STD.
        Serie: 3MDDJBCVXKM311116
        Vigencia Desde las 12:00 P.M. del:04/OCT/2025 18/OCT/2025 Servicio:PARTICULAR
        Hasta las 12:00 P.M. del:04/OCT/2026 Plazo de pago: 14 dias Movimiento:ALTA
        Forma de: SEMESTRAL Primer pago 4,993.03 Gastos por Expedición. 640.00
        IMPORTE TOTAL 9,243.66
        Condiciones generales aplicables QJ/01 1224-GA A 29 DE AGOSTO DE 2025
      `,
      expected: {
        policyNumber: "0940426625",
        clientName: "PAULINA GONZALEZ GARIBAY",
        clientRfc: "GOGP930917CX3",
        clientAddress: "BOULEVARD 5 DE MAYO No. EXT. 4231 No. INT. 1 C.P. 72534 Municipio PUEBLA Estado PUEBLA Colonia HUEXOTITLA",
        serialNumber: "3MDDJBCVXKM311116",
        startDate: "2025-10-04",
        endDate: "2026-10-04",
        issueDate: "2025-08-29",
        paymentFrequency: "SEMIANNUAL",
        premiumAmount: 9243.66,
        sourcePolicyNumber: "0940392912",
      },
    },
  ])("extracts the real Quálitas Auto layout for %s", ({ text, expected }) => {
    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyNumber).toBe(expected.policyNumber);
    expect(draft.clientName).toBe(expected.clientName);
    expect(draft.clientType).toBe("PERSON");
    expect(draft.clientRfc).toBe(expected.clientRfc);
    expect(draft.clientAddress).toContain(expected.clientAddress);
    expect(draft.policyType).toBe("AUTO");
    expect(draft.serialNumber).toBe(expected.serialNumber);
    expect(draft.startDate).toBe(expected.startDate);
    expect(draft.endDate).toBe(expected.endDate);
    expect(draft.issueDate).toBe(expected.issueDate);
    expect(draft.paymentFrequency).toBe(expected.paymentFrequency);
    expect(draft.premiumAmount).toBeCloseTo(expected.premiumAmount);
    expect(draft.requestNumber).toBeNull();
    expect(draft.sourcePolicyNumber).toBe(expected.sourcePolicyNumber);
  });

  it("builds a preview from extracted PDF text without relying on the server parser", async () => {
    const db = {
      client: {
        findMany: async () => [
          { id: "client-1", fullName: "Maria Fernanda Corral Morales" },
          { id: "client-2", fullName: "Otra Persona" },
        ],
      },
      insurer: {
        findMany: async () => [
          { id: "insurer-1", name: "Quálitas Compañía de Seguros" },
          { id: "insurer-2", name: "Aseguradora Genérica" },
        ],
      },
      policy: {
        findMany: async () => [
          {
            id: "policy-1",
            policyNumber: "50702000465",
            startDate: new Date("2025-02-01T00:00:00.000Z"),
            endDate: new Date("2026-02-01T00:00:00.000Z"),
            status: "EXPIRED",
            insuredAssets: [{ serialNumber: "ABC1234567890" }],
          },
        ],
      },
    } as never;

    const preview = await buildPolicyPdfCapturePreviewFromText(
      `
        Quálitas Compañía de Seguros
        Póliza: 50702000466
        Razón Social o Contratante: Maria Fernanda Corral Morales
        Tipo de seguro: Accidentes Personales
        Vigencia: 01/02/2026 al 01/02/2027
        Prima total $1,234.56
      `,
      db,
    );

    expect(preview.draft.policyNumber).toBe("50702000466");
    expect(preview.draft.clientName).toBe("Maria Fernanda Corral Morales");
    expect(preview.draft.clientType).toBe("PERSON");
    expect(preview.draft.insurerName).toBe("Quálitas Compañía de Seguros");
    expect(preview.draft.startDate).toBe("2026-02-01");
    expect(preview.draft.endDate).toBe("2027-02-01");
    expect(preview.draft.policyType).toBe("ACCIDENTES");
    expect(preview.draft.premiumAmount).toBeCloseTo(1234.56);
    expect(preview.suggestions.clientId).toBe("client-1");
    expect(preview.suggestions.insurerId).toBe("insurer-1");
    expect(preview.warnings).not.toContain("No pudimos detectar el número de póliza.");
    expect(preview.fieldConfidence.clientName).toBe("high");
    expect(preview.fieldConfidence.premiumAmount).toBe("high");
  });

  it("merges AI warnings into the compact preview", async () => {
    const db = {
      client: {
        findMany: async () => [{ id: "client-1", fullName: "Maria Fernanda Corral Morales" }],
      },
      insurer: {
        findMany: async () => [{ id: "insurer-1", name: "Quálitas Compañía de Seguros" }],
      },
      policy: {
        findMany: async () => [],
      },
    } as never;

    const preview = await buildPolicyPdfCapturePreviewFromDraft(
      {
        draft: {
          policyNumber: "50702000466",
          clientName: "Maria Fernanda Corral Morales",
          clientType: "PERSON",
          clientEmail: null,
          clientPhone: null,
          clientAddress: null,
          clientRfc: null,
          clientBirthDate: null,
          insurerName: "Quálitas Compañía de Seguros",
          policyType: "ACCIDENTES",
          serialNumber: null,
          startDate: "2026-02-01",
          endDate: "2027-02-01",
          issueDate: null,
          paymentFrequency: "ANNUAL",
          paymentPlan: null,
          premiumAmount: 1234.56,
          currency: "MXN",
          requestNumber: null,
          insuredObject: null,
          beneficiaryInfo: null,
          notes: null,
          sourcePolicyNumber: null,
        },
        fieldConfidence: {
          policyNumber: "high",
          clientName: "high",
          clientType: "high",
          clientEmail: "low",
          clientPhone: "low",
          clientAddress: "low",
          clientRfc: "low",
          clientBirthDate: "low",
          insurerName: "high",
          policyType: "high",
          serialNumber: "low",
          startDate: "high",
          endDate: "high",
          issueDate: "low",
          paymentFrequency: "high",
          premiumAmount: "high",
          sourcePolicyNumber: "low",
        },
        warnings: ["Advertencia local"],
        aiReview: {
          summary: "Resumen IA",
          warnings: ["Advertencia IA"],
          suggestions: [],
          corrections: [],
        },
        context: {
          user: { id: "agent-1", role: "AGENT" },
        },
      },
      db,
    );

    expect(preview.warnings).toContain("Advertencia local");
    expect(preview.warnings).toContain("Advertencia IA");
    expect(preview.provenance).toMatchObject({ extractionSource: "local", reviewSource: "ai" });
  });

  it("does not auto-select a source policy when there is no exact match", async () => {
    const db = {
      client: {
        findMany: async () => [
          { id: "client-1", fullName: "Maria Fernanda Corral Morales" },
        ],
      },
      insurer: {
        findMany: async () => [
          { id: "insurer-1", name: "Quálitas Compañía de Seguros" },
        ],
      },
      policy: {
        findMany: async () => [
          {
            id: "policy-1",
            policyNumber: "50702000464",
            startDate: new Date("2024-02-01T00:00:00.000Z"),
            endDate: new Date("2025-02-01T00:00:00.000Z"),
            status: "EXPIRED",
            insuredAssets: [{ serialNumber: "ABC1234567890" }],
          },
        ],
      },
    } as never;

    const preview = await buildPolicyPdfCapturePreviewFromText(
      `
        Quálitas Compañía de Seguros
        Póliza: 50702000466
        Razón Social o Contratante: Maria Fernanda Corral Morales
        Tipo de seguro: Accidentes Personales
        Vigencia: 01/02/2026 al 01/02/2027
        Prima total $1,234.56
      `,
      db,
    );

    expect(preview.suggestions.sourcePolicyId).toBeNull();
    expect(preview.confidence.sourcePolicy).toBe(false);
  });

  it("marks low-confidence fields when text is sparse", () => {
    const confidence = buildPolicyPdfCaptureFieldConfidence("Póliza 123456789", extractPolicyPdfDraftFromText("Póliza 123456789"));
    expect(confidence.policyNumber).toBe("high");
    expect(confidence.clientName).toBe("low");
  });
});

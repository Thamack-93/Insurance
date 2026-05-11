# Guía de Importación Desde Fuente Externa

## Resumen

Esta guía describe el flujo actual y seguro para usar una fuente tabular externa como apoyo de conciliación. El nombre del sistema origen no debe aparecer en UI, workbooks de revisión ni documentación de producto.

## Estado Actual

Conteos actuales de la base viva:

- **Pólizas:** 167
- **Recibos:** 495
- **Clientes:** 55
- **Aseguradoras:** 10

La carpeta `Clientes` puede contener agrupadores comerciales. El nombre de la carpeta no siempre coincide con el tomador final; en esos casos el campo `Referidor` preserva el vínculo comercial.

## Flujo Recomendado

```bash
cd /Users/pedrogomez/Desktop/Insurance
npm run staging:clean:ledger
npm run staging:review-pack
```

El comando:

- lee la fuente externa configurada;
- valida columnas esperadas;
- crea backup de `data/staging/canonical.sqlite`;
- genera un batch versionado;
- exporta `data/exports/canonical-ledger-clean-YYYY-MM-DD-HH-mm.xlsx`;
- no modifica `data/pg.sqlite`.

Para regenerar explícitamente el mismo archivo durante pruebas:

```bash
npm run staging:clean:ledger -- --allow-duplicate
```

Para generar una vista compacta de solo excepciones:

```bash
npm run staging:review-pack
```

## Columnas Esperadas

| Columna | Descripción |
| --- | --- |
| `No. de Póliza` | Número de póliza |
| `No. Recibo` | Número de recibo |
| `Ini Vigencia Rec` | Inicio de vigencia del recibo |
| `Fin Vigencia Rec` | Fin de vigencia del recibo |
| `Tipo Póliza` | Tipo comercial del registro |
| `Cliente` | Nombre del cliente |
| `Descripción` | Objeto asegurado o descripción |
| `Serie` | Serie/VIN cuando existe |
| `Subramo` | Ramo o subramo |
| `Compañía` | Aseguradora |
| `Inicio Vigencia Póliza` | Inicio de vigencia de póliza |
| `Fin Vigencia` | Fin de vigencia de póliza |
| `Frecuencia Pago` | Frecuencia de pago |
| `Pagado` | Indicador de pago |
| `Fecha aplicación` | Fecha de pago aplicada |
| `Moneda` | PESOS o DOLARES |
| `Prima Neta Recibo` | Prima neta |
| `Prima Total Recibo` | Prima total |
| `Estatus` | Estado del recibo/registro |

## Reglas Principales

- `PESOS` se normaliza a `MXN`.
- `DOLARES` se normaliza a `USD`.
- No se convierten montos.
- `primaNeta` y `primaTotal` se conservan separadas.
- `Receipt` representa obligación financiera.
- `Payment` representa evento real de pago.
- Endosos e importes negativos quedan como evidencia.
- Histórico importado es buscable, pero no operativo.
- Nada se promueve a `pg.sqlite` sin aprobación explícita.

## Salidas

- `Resumen`
- `Exceptions only`
- `Resumen`

Si falla el schema o se intenta reprocesar el mismo archivo sin permiso explícito, se genera:

`data/exports/canonical-ledger-error-YYYY-MM-DD-HH-mm.xlsx`

La vista completa de ledger sigue existiendo como respaldo, pero la revisión operativa primaria usa el review pack limpio.

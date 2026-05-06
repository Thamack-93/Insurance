# Guía de Importación SAPS

## Resumen de Importación (Mayo 2026)

### Datos Importados
- **Pólizas:** 167
- **Recibos:** 495
- **Clientes:** 55
- **Aseguradoras:** 10
- **Documentos:** 167

### Proceso de Importación

#### 1. Preparación
```bash
# Archivos requeridos:
# - CSV SAPS: /Users/pedrogomez/Downloads/DescargaSAPS.csv
# - PDFs: /Users/pedrogomez/Desktop/Polizas Pedro/Clientes
```

#### 2. Comando de Importación
```bash
cd /Users/pedrogomez/Desktop/Insurance
npx tsx scripts/import-from-saps.ts \
  "/Users/pedrogomez/Downloads/DescargaSAPS.csv" \
  "/Users/pedrogomez/Desktop/Polizas Pedro/Clientes"
```

#### 3. Estructura del CSV SAPS
| Columna | Campo | Descripción |
|---------|-------|-------------|
| 1 | No. Póliza | Número de póliza |
| 2 | No. Recibo | Número de recibo |
| 3 | Ini Vigencia Rec | Inicio vigencia recibo |
| 4 | Fin Vigencia Rec | Fin vigencia recibo |
| 8 | Tipo Póliza | AUTO, GMM, VIDA, etc. |
| 9 | Cliente | Nombre del cliente |
| 10 | Descripción | Descripción del vehículo |
| 18 | Compañía | Nombre de aseguradora |
| 20 | Inicio Vigencia Póliza | Fecha inicio póliza |
| 21 | Fin Vigencia | Fecha fin póliza |
| 24 | Frecuencia Pago | Mensual, Trimestral, etc. |
| 29 | Prima Total Recibo | Monto del recibo |
| 30 | Estatus | SI/NO/PENDIENTE |

### Mapeo de Datos

#### Tipos de Póliza
- `INDIVIDUAL` → `AUTO`
- `AUTO`, `VEHICULAR`, `FLOTILLA` → `AUTO`
- `GMM`, `GASTOS`, `MEDICO` → `GMM`
- `VIDA`, `LIFE` → `VIDA`

#### Frecuencias de Pago
- `MENSUAL` → `MONTHLY`
- `TRIMESTRAL` → `QUARTERLY`
- `SEMESTRAL` → `SEMIANNUAL`
- `ANUAL` → `ANNUAL`

#### Estados de Recibo
- `SI` → `PAID`
- `NO`, `PENDIENTE` → `PENDING`

### Problemas Conocidos

1. **44 recibos no importados:** Pertenecen a pólizas sin PDF coincidente
2. **Pólizas canceladas:** Excluidas de la importación (1009024, 1009079, etc.)

### Verificación Post-Importación

```bash
# Conteos
sqlite3 data/pg.sqlite "SELECT COUNT(*) FROM Policy;"
sqlite3 data/pg.sqlite "SELECT COUNT(*) FROM Receipt;"

# Recibos por estado
sqlite3 data/pg.sqlite "SELECT status, COUNT(*) FROM Receipt GROUP BY status;"

# Primas por aseguradora
sqlite3 data/pg.sqlite "SELECT i.name, SUM(r.amount) FROM Receipt r JOIN Policy p ON r.policyId = p.id JOIN Insurer i ON p.insurerId = i.id GROUP BY i.name;"
```

### Backup
Backup automático creado en: `data/backups/policydesk-2026-05-06-10-27.sqlite`

### Scripts Relacionados
- `import-from-saps.ts` - Importación principal
- `preview-saps-import.ts` - Previsualización
- `validate-data-quality.ts` - Validación
- `backup-db.ts` - Respaldo

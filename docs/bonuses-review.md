# Revisión y aprobación de bonos

Las proyecciones de bonos son snapshots de cálculo. El job `bonus-run-retention`
elimina todas las corridas cinco días después de su última actualización,
incluidos los cierres aprobados. Al eliminar una corrida también se eliminan
sus partidas. Descarga el snapshot y el detalle antes de ese plazo si necesitas
conservar una copia.

Una proyección sin partidas de pago no se puede aprobar. Las partidas en estado
de revisión también bloquean la aprobación hasta que se resuelvan y se genere
una versión lista. Un bono calculado en cero puede ser válido si la proyección
tiene partidas de pago y cumple las demás condiciones del programa.

En la tabla de partidas, abre el recibo o la póliza para revisar su información
fuente. Usa el enlace para regresar a la misma proyección.

Si la proyección cambia mientras la tienes abierta, el sistema rechaza la
acción con la versión anterior. Recarga la versión actual y revisa sus partidas
antes de aceptar la prima o aprobar el cierre. El sistema no reintenta la
acción ni combina cambios automáticamente.

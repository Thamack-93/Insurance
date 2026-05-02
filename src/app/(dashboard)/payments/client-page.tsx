"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, DollarSign, Clock, AlertCircle } from "lucide-react";
import { formatCurrency, toNumber } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getPaymentStats, getPendingReceipts, getPaymentHistory } from "./actions";
import { QuickPaymentDialog } from "@/components/payments/quick-payment-dialog";
import { toast } from "sonner";
import Link from "next/link";

export default function PaymentsClientPage() {
  const [stats, setStats] = useState<any>({
    totalPaymentsThisMonth: 0,
    paymentsCountThisMonth: 0,
    pendingReceiptsCount: 0,
    overdueReceiptsCount: 0,
  });
  const [pendingReceipts, setPendingReceipts] = useState<any[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [statsData, receiptsData, historyData] = await Promise.all([
          getPaymentStats(),
          getPendingReceipts(),
          getPaymentHistory(20),
        ]);
        setStats(statsData);
        setPendingReceipts(receiptsData);
        setPaymentHistory(historyData);
      } catch (error) {
        toast.error("Error al cargar datos de pagos");
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const handlePaymentComplete = () => {
    // Reload data after payment
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <p>Cargando datos de pagos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pagos</h1>
          <p className="text-muted-foreground">
            Gestiona los pagos de recibos y consulta el historial
          </p>
        </div>
        <Link href="/payments/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Pago
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pagos este mes</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalPaymentsThisMonth)}</div>
            <p className="text-xs text-muted-foreground">
              {stats.paymentsCountThisMonth} pagos registrados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recibos pendientes</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingReceiptsCount}</div>
            <p className="text-xs text-muted-foreground">
              Por cobrar
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recibos vencidos</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.overdueReceiptsCount}</div>
            <p className="text-xs text-muted-foreground">
              Requieren atención
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasa de cobro</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.pendingReceiptsCount + stats.overdueReceiptsCount > 0 
                ? Math.round((stats.paymentsCountThisMonth / (stats.pendingReceiptsCount + stats.overdueReceiptsCount + stats.paymentsCountThisMonth)) * 100)
                : 100}%
            </div>
            <p className="text-xs text-muted-foreground">
              Este mes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Receipts */}
      <Card>
        <CardHeader>
          <CardTitle>Recibos Pendientes</CardTitle>
          <CardDescription>
            Recibos que están pendientes de pago. Haz clic para registrar un pago.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingReceipts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No hay recibos pendientes</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingReceipts.map((receipt) => (
                <div key={receipt.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium">{receipt.receiptNumber}</span>
                      <Badge variant={new Date(receipt.dueDate) < new Date() ? "destructive" : "secondary"}>
                        {new Date(receipt.dueDate) < new Date() ? "Vencido" : "Pendiente"}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>{receipt.client.fullName}</p>
                      <p>Póliza: {receipt.policy.policyNumber}</p>
                      <p>Vencimiento: {formatDate(receipt.dueDate)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-semibold">{formatCurrency(receipt.amount)}</div>
                      <div className="text-sm text-muted-foreground">{receipt.currency}</div>
                    </div>
                    <QuickPaymentDialog 
                      receipt={{
                        ...receipt,
                        dueDate: receipt.dueDate.toISOString().split('T')[0],
                      }}
                      onPaymentComplete={handlePaymentComplete}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Pagos</CardTitle>
          <CardDescription>
            Últimos pagos registrados en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paymentHistory.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No hay pagos registrados</p>
            </div>
          ) : (
            <div className="space-y-4">
              {paymentHistory.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium">{payment.receipt.receiptNumber}</span>
                      <Badge variant="default">Pagado</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>{payment.client.fullName}</p>
                      <p>Póliza: {payment.policy.policyNumber}</p>
                      <p>Fecha de pago: {formatDate(payment.paidDate)}</p>
                      {payment.paymentMethod && (
                        <p>Método: {payment.paymentMethod}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-semibold">{formatCurrency(payment.amount)}</div>
                      <div className="text-sm text-muted-foreground">{payment.currency}</div>
                    </div>
                    <Button variant="outline" size="sm">
                      Ver
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

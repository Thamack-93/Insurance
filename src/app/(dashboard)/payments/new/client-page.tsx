"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PaymentForm } from "@/components/forms/payment-form";
import { createPayment } from "../actions";
import { getPendingReceipts } from "../actions";
import { toast } from "sonner";

export default function NewPaymentClientPage() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load receipts on mount
  useEffect(() => {
    const loadReceipts = async () => {
      try {
        const data = await getPendingReceipts();
        setReceipts(data);
      } catch (error) {
        toast.error("Error al cargar recibos pendientes");
      } finally {
        setIsLoading(false);
      }
    };
    loadReceipts();
  }, []);

  const handleCreatePayment = async (data: any) => {
    try {
      await createPayment(data);
      toast.success("Pago registrado exitosamente");
      router.push("/payments");
    } catch (error) {
      toast.error("Error al registrar el pago");
      throw error;
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <PaymentForm
        receipts={receipts}
        onSubmit={handleCreatePayment}
        onCancel={() => router.push("/payments")}
      />
    </div>
  );
}

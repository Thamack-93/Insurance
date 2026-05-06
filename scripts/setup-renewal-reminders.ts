#!/usr/bin/env tsx

import { getDb } from '../src/lib/db';
import { addDays, addMonths, format } from 'date-fns';

async function main() {
  const db = getDb();
  
  console.log('Configurando recordatorios de renovación...\n');
  
  // Get all active policies with end dates
  const policies = await db.policy.findMany({
    where: {
      status: 'ACTIVE',
      endDate: {
        gt: new Date(),
      },
    },
  });
  
  let remindersCreated = 0;
  
  for (const policy of policies) {
    if (!policy.endDate) continue;
    
    const endDate = new Date(policy.endDate);
    const today = new Date();
    
    // Only create reminders for policies expiring in next 90 days
    const daysUntilExpiry = Math.floor((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilExpiry > 90 || daysUntilExpiry < 0) {
      continue; // Skip if too far in future or already expired
    }
    
    // Create reminder dates: 60, 30, 15, 7, 1 days before expiry
    const reminderDays = [60, 30, 15, 7, 1];
    
    for (const daysBefore of reminderDays) {
      const reminderDate = addDays(endDate, -daysBefore);
      
      // Skip if reminder date is in the past
      if (reminderDate < today) {
        continue;
      }
      
      // Check if reminder already exists
      const existing = await db.reminder.findFirst({
        where: {
          entityType: 'POLICY',
          entityId: policy.id,
          reminderDate: reminderDate,
        },
      });
      
      if (existing) {
        continue;
      }
      
      // Get client name
      const client = await db.client.findUnique({
        where: { id: policy.clientId },
      });
      
      // Create reminder
      await db.reminder.create({
        data: {
          entityType: 'POLICY',
          entityId: policy.id,
          title: `Renovación: ${policy.policyNumber}`,
          description: `La póliza ${policy.policyNumber} de ${client?.fullName || 'Cliente'} vence el ${format(endDate, 'dd/MM/yyyy')}.`,
          reminderDate: reminderDate,
          status: 'ACTIVE',
        },
      });
      
      remindersCreated++;
    }
  }
  
  console.log(`✅ Recordatorios creados: ${remindersCreated}`);
  console.log(`📊 Pólizas procesadas: ${policies.length}`);
}

main().catch(console.error);

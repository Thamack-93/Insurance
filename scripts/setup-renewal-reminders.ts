#!/usr/bin/env tsx

import { getDb } from '../src/lib/db';
import { addDays, format } from 'date-fns';

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
      const sourceId = `${policy.id}:${reminderDate.toISOString()}`;
      const existing = await db.workItem.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'Reminder',
            sourceId,
          },
        },
      });
      
      if (existing) {
        continue;
      }
      
      // Get client name
      const client = await db.client.findUnique({
        where: { id: policy.clientId },
      });
      
      // Create reminder work item
      await db.workItem.create({
        data: {
          sourceType: 'Reminder',
          sourceId,
          workItemType: 'REMINDER',
          status: 'OPEN',
          priority: 'MEDIUM',
          title: `Renovación: ${policy.policyNumber}`,
          description: `La póliza ${policy.policyNumber} de ${client?.fullName || 'Cliente'} vence el ${format(endDate, 'dd/MM/yyyy')}.`,
          entityType: 'POLICY',
          entityId: policy.id,
          dueDate: reminderDate,
          startDate: new Date(),
        },
      });
      
      remindersCreated++;
    }
  }
  
  console.log(`✅ Recordatorios creados: ${remindersCreated}`);
  console.log(`📊 Pólizas procesadas: ${policies.length}`);
}

main().catch(console.error);

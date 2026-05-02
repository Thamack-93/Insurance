"use server";

import { getDb } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { formatDate, today } from "@/lib/dates";
import { subMonths, subYears } from "date-fns";

export interface ReportData {
  period: string;
  startDate: Date;
  endDate: Date;
  data: any;
}

export interface FinancialReport {
  totalPremium: number;
  totalCommissions: number;
  totalClaims: number;
  netProfit: number;
  policiesCount: number;
  newClients: number;
  renewalRate: number;
  claimsRatio: number;
}

export interface PolicyReport {
  policyType: string;
  count: number;
  totalPremium: number;
  averagePremium: number;
  renewalRate: number;
  claimsCount: number;
  claimsAmount: number;
}

export interface ClientReport {
  clientId: string;
  clientName: string;
  policiesCount: number;
  totalPremium: number;
  claimsCount: number;
  lastPolicyDate?: Date;
  renewalRate: number;
}

export async function generateFinancialReport(
  startDate: Date,
  endDate: Date,
  period: string
): Promise<ReportData> {
  const db = getDb();
  
  try {
    // Get policies in the period
    const policies = await db.policy.findMany({
      where: {
        startDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        client: true,
        insurer: true,
        receipts: true,
        claims: true,
        commissions: true,
      },
    });

    // Calculate financial metrics
    const totalPremium = policies.reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0);
    const totalCommissions = policies.reduce((sum, policy) => 
      sum + policy.commissions.reduce((commSum, comm) => commSum + toNumber(comm.expectedAmount), 0), 0);
    const totalClaims = policies.reduce((sum, policy) => 
      sum + policy.claims.reduce((claimSum, claim) => claimSum + toNumber(claim.amountClaimed || 0), 0), 0);
    
    // Get new clients in period
    const newClients = await db.client.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Calculate renewal rate
    const renewedPolicies = await db.policy.count({
      where: {
        renewalDate: {
          gte: startDate,
          lte: endDate,
        },
        status: "ACTIVE",
      },
    });
    const renewalRate = policies.length > 0 ? (renewedPolicies / policies.length) * 100 : 0;

    // Calculate claims ratio
    const claimsRatio = totalPremium > 0 ? (totalClaims / totalPremium) * 100 : 0;

    const report: FinancialReport = {
      totalPremium,
      totalCommissions,
      totalClaims,
      netProfit: totalPremium - totalCommissions - totalClaims,
      policiesCount: policies.length,
      newClients,
      renewalRate,
      claimsRatio,
    };

    return {
      period,
      startDate,
      endDate,
      data: report,
    };
  } catch (error) {
    console.error("Error generating financial report:", error);
    throw error;
  }
}

export async function generatePolicyTypeReport(
  startDate: Date,
  endDate: Date,
  period: string
): Promise<ReportData> {
  const db = getDb();
  
  try {
    const policies = await db.policy.findMany({
      where: {
        startDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        claims: true,
        commissions: true,
      },
    });

    // Group by policy type
    const policyTypeGroups = policies.reduce((groups, policy) => {
      const type = policy.policyType;
      if (!groups[type]) {
        groups[type] = {
          count: 0,
          totalPremium: 0,
          claims: [],
          commissions: [],
        };
      }
      groups[type].count++;
      groups[type].totalPremium += toNumber(policy.premiumAmount);
      groups[type].claims.push(...policy.claims);
      groups[type].commissions.push(...policy.commissions);
      return groups;
    }, {} as Record<string, any>);

    const report: PolicyReport[] = Object.entries(policyTypeGroups).map(([policyType, group]) => {
      const claimsAmount = group.claims.reduce((sum: number, claim: any) => 
        sum + toNumber(claim.amountClaimed || 0), 0);
      const renewalRate = Math.random() * 30 + 70; // Placeholder calculation

      return {
        policyType,
        count: group.count,
        totalPremium: group.totalPremium,
        averagePremium: group.totalPremium / group.count,
        renewalRate,
        claimsCount: group.claims.length,
        claimsAmount,
      };
    });

    return {
      period,
      startDate,
      endDate,
      data: report,
    };
  } catch (error) {
    console.error("Error generating policy type report:", error);
    throw error;
  }
}

export async function generateClientPerformanceReport(
  startDate: Date,
  endDate: Date,
  period: string
): Promise<ReportData> {
  const db = getDb();
  
  try {
    const clients = await db.client.findMany({
      include: {
        policies: {
          where: {
            startDate: {
              gte: startDate,
              lte: endDate,
            },
          },
          include: {
            claims: true,
            commissions: true,
          },
        },
      },
    });

    const report: ClientReport[] = clients
      .filter(client => client.policies.length > 0)
      .map(client => {
        const totalPremium = client.policies.reduce((sum, policy) => 
          sum + toNumber(policy.premiumAmount), 0);
        const claimsCount = client.policies.reduce((sum, policy) => 
          sum + policy.claims.length, 0);
        
        const lastPolicyDate = client.policies
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0]?.startDate;
        
        const renewalRate = Math.random() * 30 + 70; // Placeholder calculation

        return {
          clientId: client.id,
          clientName: client.fullName,
          policiesCount: client.policies.length,
          totalPremium,
          claimsCount,
          lastPolicyDate,
          renewalRate,
        };
      })
      .sort((a, b) => b.totalPremium - a.totalPremium);

    return {
      period,
      startDate,
      endDate,
      data: report,
    };
  } catch (error) {
    console.error("Error generating client performance report:", error);
    throw error;
  }
}

export async function generateMonthlyTrendsReport(year: number): Promise<ReportData> {
  const db = getDb();
  
  try {
    const monthlyData = [];
    
    for (let month = 0; month < 12; month++) {
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);
      
      const policies = await db.policy.findMany({
        where: {
          startDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          receipts: true,
          claims: true,
          commissions: true,
        },
      });

      const monthData = {
        month: month + 1,
        monthName: startDate.toLocaleDateString('es-MX', { month: 'long' }),
        policiesCount: policies.length,
        totalPremium: policies.reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0),
        totalClaims: policies.reduce((sum, policy) => 
          sum + policy.claims.reduce((claimSum, claim) => claimSum + toNumber(claim.amountClaimed || 0), 0), 0),
        totalCommissions: policies.reduce((sum, policy) => 
          sum + policy.commissions.reduce((commSum, comm) => commSum + toNumber(comm.expectedAmount), 0), 0),
        newClients: await db.client.count({
          where: {
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        }),
      };

      monthlyData.push(monthData);
    }

    return {
      period: `${year}`,
      startDate: new Date(year, 0, 1),
      endDate: new Date(year, 11, 31),
      data: monthlyData,
    };
  } catch (error) {
    console.error("Error generating monthly trends report:", error);
    throw error;
  }
}

export async function generateInsurerPerformanceReport(
  startDate: Date,
  endDate: Date,
  period: string
): Promise<ReportData> {
  const db = getDb();
  
  try {
    const insurers = await db.insurer.findMany({
      include: {
        policies: {
          where: {
            startDate: {
              gte: startDate,
              lte: endDate,
            },
          },
          include: {
            claims: true,
            commissions: true,
            receipts: true,
          },
        },
      },
    });

    const report = insurers.map(insurer => {
      const policies = insurer.policies;
      const totalPremium = policies.reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0);
      const totalClaims = policies.reduce((sum, policy) => 
        sum + policy.claims.reduce((claimSum, claim) => claimSum + toNumber(claim.amountClaimed || 0), 0), 0);
      const totalCommissions = policies.reduce((sum, policy) => 
        sum + policy.commissions.reduce((commSum, comm) => commSum + toNumber(comm.expectedAmount), 0), 0);
      
      const claimsRatio = totalPremium > 0 ? (totalClaims / totalPremium) * 100 : 0;
      const commissionRate = totalPremium > 0 ? (totalCommissions / totalPremium) * 100 : 0;

      return {
        insurerId: insurer.id,
        insurerName: insurer.name,
        policiesCount: policies.length,
        totalPremium,
        totalClaims,
        totalCommissions,
        claimsRatio,
        commissionRate,
        averagePremium: policies.length > 0 ? totalPremium / policies.length : 0,
      };
    }).sort((a, b) => b.totalPremium - a.totalPremium);

    return {
      period,
      startDate,
      endDate,
      data: report,
    };
  } catch (error) {
    console.error("Error generating insurer performance report:", error);
    throw error;
  }
}

export async function getAvailableReportPeriods() {
  const db = getDb();
  
  try {
    const oldestPolicy = await db.policy.findFirst({
      orderBy: { startDate: "asc" },
      select: { startDate: true },
    });

    const newestPolicy = await db.policy.findFirst({
      orderBy: { startDate: "desc" },
      select: { startDate: true },
    });

    if (!oldestPolicy || !newestPolicy) {
      return {
        available: false,
        message: "No hay pólizas disponibles para generar reportes",
      };
    }

    const todayDate = new Date(today());
    const periods = [];

    // Add predefined periods
    periods.push({
      label: "Último mes",
      value: "last_month",
      startDate: subMonths(todayDate, 1),
      endDate: todayDate,
    });

    periods.push({
      label: "Últimos 3 meses",
      value: "last_quarter",
      startDate: subMonths(todayDate, 3),
      endDate: todayDate,
    });

    periods.push({
      label: "Últimos 6 meses",
      value: "last_half_year",
      startDate: subMonths(todayDate, 6),
      endDate: todayDate,
    });

    periods.push({
      label: "Último año",
      value: "last_year",
      startDate: subYears(todayDate, 1),
      endDate: todayDate,
    });

    // Add current year
    const currentYear = todayDate.getFullYear();
    periods.push({
      label: `Año ${currentYear}`,
      value: `year_${currentYear}`,
      startDate: new Date(currentYear, 0, 1),
      endDate: new Date(currentYear, 11, 31),
    });

    // Add previous year if data exists
    const previousYear = currentYear - 1;
    if (oldestPolicy.startDate.getFullYear() <= previousYear) {
      periods.push({
        label: `Año ${previousYear}`,
        value: `year_${previousYear}`,
        startDate: new Date(previousYear, 0, 1),
        endDate: new Date(previousYear, 11, 31),
      });
    }

    return {
      available: true,
      periods,
      dataRange: {
        start: formatDate(oldestPolicy.startDate),
        end: formatDate(newestPolicy.startDate),
      },
    };
  } catch (error) {
    console.error("Error getting available report periods:", error);
    return {
      available: false,
      message: "Error al obtener períodos disponibles",
    };
  }
}

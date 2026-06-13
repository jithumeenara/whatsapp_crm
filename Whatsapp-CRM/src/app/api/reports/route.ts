import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const accountId = ctx.accountId

    const [
      totalLeads,
      leadsByStatus,
      leadsByScore,
      totalFollowUps,
      followUpsByStatus,
      totalTasks,
      tasksByStatus,
      tasksByPriority,
      totalContacts,
      recentActivities,
      overdueFollowUps,
    ] = await Promise.all([
      prisma.lead.count({ where: { account_id: accountId } }),

      prisma.lead.groupBy({
        by: ['status'],
        where: { account_id: accountId },
        _count: { id: true },
      }),

      prisma.lead.groupBy({
        by: ['score'],
        where: { account_id: accountId },
        _count: { id: true },
      }),

      prisma.followUp.count({ where: { account_id: accountId } }),

      prisma.followUp.groupBy({
        by: ['status'],
        where: { account_id: accountId },
        _count: { id: true },
      }),

      prisma.task.count({ where: { account_id: accountId } }),

      prisma.task.groupBy({
        by: ['status'],
        where: { account_id: accountId },
        _count: { id: true },
      }),

      prisma.task.groupBy({
        by: ['priority'],
        where: { account_id: accountId },
        _count: { id: true },
      }),

      prisma.contact.count({ where: { account_id: accountId } }),

      prisma.leadActivity.findMany({
        where: { account_id: accountId },
        orderBy: { created_at: 'desc' },
        take: 10,
        include: {
          user: { select: { id: true, name: true } },
          lead: { select: { id: true, title: true } },
          contact: { select: { id: true, name: true } },
        },
      }),

      prisma.followUp.count({
        where: {
          account_id: accountId,
          status: 'pending',
          due_at: { lt: new Date() },
        },
      }),
    ])

    // Leads created over last 30 days (daily buckets)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const recentLeads = await prisma.lead.findMany({
      where: { account_id: accountId, created_at: { gte: thirtyDaysAgo } },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    })

    // Group by date string
    const leadsByDay: Record<string, number> = {}
    for (const lead of recentLeads) {
      const day = lead.created_at.toISOString().slice(0, 10)
      leadsByDay[day] = (leadsByDay[day] ?? 0) + 1
    }

    return NextResponse.json({
      leads: {
        total: totalLeads,
        byStatus: leadsByStatus.map((r) => ({ status: r.status, count: r._count.id })),
        byScore: leadsByScore.map((r) => ({ score: r.score, count: r._count.id })),
        byDay: leadsByDay,
      },
      followUps: {
        total: totalFollowUps,
        overdue: overdueFollowUps,
        byStatus: followUpsByStatus.map((r) => ({ status: r.status, count: r._count.id })),
      },
      tasks: {
        total: totalTasks,
        byStatus: tasksByStatus.map((r) => ({ status: r.status, count: r._count.id })),
        byPriority: tasksByPriority.map((r) => ({ priority: r.priority, count: r._count.id })),
      },
      contacts: { total: totalContacts },
      recentActivities,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

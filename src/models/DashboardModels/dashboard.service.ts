import { Op, QueryTypes } from "sequelize";

import { ORDER_STATUS_VALUES, RETURN_STATUS_VALUES, type OrderStatus } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Order } from "../../database/tables/OrderTable/index.js";
import { OrderItem } from "../../database/tables/OrderItemTable/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ReturnRequest } from "../../database/tables/ReturnRequestTable/index.js";
import { Shipment } from "../../database/tables/ShipmentTable/index.js";
import { User } from "../../database/tables/UserTable/index.js";
import type {
  DashboardCustomerOverview,
  DashboardFilterOptionsJSON,
  DashboardFulfilment,
  DashboardInsight,
  DashboardLocationRow,
  DashboardOrderRow,
  DashboardOrderStatusSlice,
  DashboardProductPerformanceRow,
  DashboardQuery,
  DashboardReturnsOverview,
  DashboardSummaryJSON,
  DashboardTimeSeriesPoint,
  MetricComparison
} from "./dashboard.types.js";

/**
 * Real-data replacement for the previous synthetic COMMERCE_EVENTS-driven
 * dashboard. There is no session/page-view/traffic-source tracking anywhere
 * in this system, so metrics that would require it (conversion rate, the
 * sessions->views->cart->checkout funnel, traffic sources, product view
 * counts) are not computed here at all — see the Admin's
 * dashboard-view.tsx / removed section components. Everything below is
 * derived directly from Orders, OrderItems, ReturnRequests, Shipments and
 * Users.
 */

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function startOfDayUTC(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

function endOfDayUTC(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(23, 59, 59, 999);
  return c;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sumBy<T>(arr: T[], fn: (item: T) => number): number {
  return arr.reduce((sum, item) => sum + fn(item), 0);
}

function comparisonOf(value: number, previousValue: number, compare: boolean): MetricComparison {
  if (!compare) return { value, previousValue: 0, changePct: null };
  if (previousValue === 0) return { value, previousValue, changePct: value === 0 ? 0 : null };
  return { value, previousValue, changePct: round1(((value - previousValue) / previousValue) * 100) };
}

function resolvePreviousRange(from: Date, to: Date): { from: Date; to: Date } {
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs);
  return { from: startOfDayUTC(prevFrom), to: endOfDayUTC(prevTo) };
}

async function resolveOrderIdsForProduct(productId: number): Promise<number[]> {
  const rows = await sequelize.query<{ order_id: number }>(
    "SELECT DISTINCT `order_id` FROM `order_items` WHERE `product_id` = ?",
    { replacements: [productId], type: QueryTypes.SELECT }
  );
  return rows.map((row) => row.order_id);
}

async function loadOrdersInRange(from: Date, to: Date, query: DashboardQuery): Promise<Order[]> {
  const where: Record<string | symbol, unknown> = {
    placed_at: { [Op.gte]: from, [Op.lte]: to }
  };
  if (query.orderStatus) where.status = query.orderStatus;
  if (query.state) where.ship_state = query.state;
  if (query.productId) {
    const ids = await resolveOrderIdsForProduct(query.productId);
    where.id = { [Op.in]: ids.length > 0 ? ids : [-1] };
  }

  return Order.findAll({
    where,
    include: [
      { model: User, as: "user", attributes: ["id", "name", "created_at"] },
      { model: OrderItem, as: "items" },
      { model: Shipment, as: "shipments" }
    ],
    order: [["placed_at", "ASC"]]
  });
}

async function loadReturnsInRange(from: Date, to: Date, query: DashboardQuery): Promise<ReturnRequest[]> {
  const rows = await ReturnRequest.findAll({
    where: { requested_at: { [Op.gte]: from, [Op.lte]: to } },
    include: [
      { model: OrderItem, as: "orderItem", attributes: ["id", "product_id"] },
      { model: Order, as: "order", attributes: ["id", "ship_state"] }
    ]
  });

  return rows.filter((row) => {
    if (query.state && row.order?.ship_state !== query.state) return false;
    if (query.productId && row.orderItem?.product_id !== query.productId) return false;
    return true;
  });
}

type Bucket = { key: string; label: string; start: Date; end: Date };

function buildBuckets(from: Date, to: Date, groupBy: "day" | "week"): Bucket[] {
  const buckets: Bucket[] = [];
  if (groupBy === "day") {
    const cursor = new Date(from);
    while (cursor <= to) {
      const start = startOfDayUTC(cursor);
      const end = endOfDayUTC(cursor);
      buckets.push({ key: start.toISOString().slice(0, 10), label: `${start.getUTCDate()}/${start.getUTCMonth() + 1}`, start, end });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else {
    let start = startOfDayUTC(from);
    while (start <= to) {
      const rawEnd = new Date(start.getTime() + 6 * 86_400_000);
      const end = endOfDayUTC(rawEnd) < to ? endOfDayUTC(rawEnd) : to;
      buckets.push({ key: start.toISOString().slice(0, 10), label: `Wk ${start.getUTCDate()}/${start.getUTCMonth() + 1}`, start, end });
      start = new Date(start.getTime() + 7 * 86_400_000);
    }
  }
  return buckets;
}

function fillSeries(buckets: Bucket[], orders: Order[]): DashboardTimeSeriesPoint[] {
  return buckets.map((b) => {
    const inBucket = orders.filter((o) => {
      const t = o.placed_at.getTime();
      return t >= b.start.getTime() && t <= b.end.getTime();
    });
    const paidInBucket = inBucket.filter((o) => o.payment_status === "paid");
    return {
      date: b.key,
      label: b.label,
      sales: sumBy(paidInBucket, (o) => Number(o.total)),
      orders: inBucket.length,
      units: sumBy(inBucket, (o) => sumBy(o.items ?? [], (i) => i.quantity))
    };
  });
}

function computeOrderStatusSlices(allOrders: Order[]): DashboardOrderStatusSlice[] {
  const counts = new Map<OrderStatus, number>(ORDER_STATUS_VALUES.map((s) => [s, 0]));
  allOrders.forEach((o) => counts.set(o.status, (counts.get(o.status) ?? 0) + 1));
  const total = Math.max(1, allOrders.length);
  return ORDER_STATUS_VALUES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
    percentage: round1(((counts.get(status) ?? 0) / total) * 100)
  }));
}

function computeRecentOrders(allOrders: Order[]): DashboardOrderRow[] {
  return [...allOrders]
    .sort((a, b) => b.placed_at.getTime() - a.placed_at.getTime())
    .slice(0, 8)
    .map((o) => ({
      orderId: o.id,
      orderNumber: o.order_number,
      customerLabel: o.user?.name ?? o.ship_recipient_name,
      total: Number(o.total),
      status: o.status,
      placedAt: o.placed_at.toISOString(),
      itemCount: sumBy(o.items ?? [], (i) => i.quantity)
    }));
}

// "Delayed" is a heuristic (in-transit shipments older than DELAY_THRESHOLD_DAYS
// with no delivery yet) — there is no carrier SLA configured anywhere in this
// system to compare against, unlike the previous synthetic per-shipping-mode
// transit-day table.
const DELAY_THRESHOLD_DAYS = 5;
const IN_TRANSIT_SHIPMENT_STATUSES = new Set(["pickup_pending", "picked_up", "in_transit", "out_for_delivery", "delivery_exception", "ndr"]);

function computeFulfilment(orders: Order[], now: Date): DashboardFulfilment {
  let awaitingFulfilment = 0;
  let packed = 0;
  let shipped = 0;
  let delivered = 0;
  let delayed = 0;
  let standardOrders = 0;
  let expressOrders = 0;
  const processingHours: number[] = [];
  const deliveryDays: number[] = [];

  for (const order of orders) {
    if (order.status === "pending" || order.status === "confirmed") awaitingFulfilment += 1;
    else if (order.status === "processing") packed += 1;
    else if (order.status === "shipped") shipped += 1;
    else if (order.status === "delivered" || order.status === "return_requested") delivered += 1;

    for (const shipment of order.shipments ?? []) {
      if (shipment.method === "express") expressOrders += 1;
      else standardOrders += 1;

      if (IN_TRANSIT_SHIPMENT_STATUSES.has(shipment.status) && shipment.shipped_at) {
        const ageDays = (now.getTime() - shipment.shipped_at.getTime()) / 86_400_000;
        if (ageDays > DELAY_THRESHOLD_DAYS) delayed += 1;
      }

      if (shipment.shipped_at) {
        processingHours.push((shipment.shipped_at.getTime() - order.placed_at.getTime()) / 3_600_000);
      }
      if (shipment.delivered_at) {
        deliveryDays.push((shipment.delivered_at.getTime() - order.placed_at.getTime()) / 86_400_000);
      }
    }
  }

  const avg = (arr: number[]) => (arr.length ? round1(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  return {
    awaitingFulfilment,
    packed,
    shipped,
    delivered,
    delayed,
    avgProcessingHours: avg(processingHours),
    avgDeliveryDays: avg(deliveryDays),
    standardOrders,
    expressOrders
  };
}

function computeLocations(orders: Order[]): DashboardLocationRow[] {
  const byLoc = new Map<string, { state: string; city: string; orders: Set<number>; customers: Set<number>; revenue: number }>();
  orders.forEach((o) => {
    const key = `${o.ship_state}|${o.ship_city}`;
    const entry = byLoc.get(key) ?? { state: o.ship_state, city: o.ship_city, orders: new Set<number>(), customers: new Set<number>(), revenue: 0 };
    entry.orders.add(o.id);
    if (o.user_id) entry.customers.add(o.user_id);
    entry.revenue += Number(o.total);
    byLoc.set(key, entry);
  });
  return [...byLoc.values()]
    .map((v) => ({
      state: v.state,
      city: v.city,
      orders: v.orders.size,
      customers: v.customers.size,
      revenue: v.revenue,
      averageOrderValue: v.orders.size > 0 ? Math.round(v.revenue / v.orders.size) : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

async function computeCustomerOverview(orders: Order[], from: Date): Promise<DashboardCustomerOverview> {
  const firstOrderRows = await sequelize.query<{ user_id: number; first_at: string }>(
    "SELECT `user_id`, MIN(`placed_at`) AS first_at FROM `orders` WHERE `user_id` IS NOT NULL AND `status` != 'cancelled' GROUP BY `user_id`",
    { type: QueryTypes.SELECT }
  );
  const firstOrderMap = new Map(firstOrderRows.map((r) => [r.user_id, r.first_at]));
  const fromIso = from.toISOString();

  const byCustomer = new Map<number, { revenue: number; lastAt: string; lastOrderUserName: string }>();
  orders.forEach((o) => {
    if (!o.user_id) return;
    const entry = byCustomer.get(o.user_id) ?? { revenue: 0, lastAt: o.placed_at.toISOString(), lastOrderUserName: o.user?.name ?? o.ship_recipient_name };
    entry.revenue += Number(o.total);
    if (o.placed_at.toISOString() > entry.lastAt) {
      entry.lastAt = o.placed_at.toISOString();
      entry.lastOrderUserName = o.user?.name ?? o.ship_recipient_name;
    }
    byCustomer.set(o.user_id, entry);
  });

  let newCustomers = 0;
  let returningCustomers = 0;
  let returningCustomerRevenue = 0;
  const rows: { id: number; name: string; joinedAt: string; lastAt: string; isReturning: boolean }[] = [];

  for (const [userId, entry] of byCustomer) {
    const firstEverAt = firstOrderMap.get(userId) ?? entry.lastAt;
    const isReturning = firstEverAt < fromIso;
    if (isReturning) {
      returningCustomers += 1;
      returningCustomerRevenue += entry.revenue;
    } else {
      newCustomers += 1;
    }
    rows.push({ id: userId, name: entry.lastOrderUserName, joinedAt: firstEverAt, lastAt: entry.lastAt, isReturning });
  }

  rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const total = newCustomers + returningCustomers;

  return {
    newCustomers,
    returningCustomers,
    firstTimeBuyers: newCustomers,
    repeatPurchaseRate: total > 0 ? round1((returningCustomers / total) * 100) : 0,
    returningCustomerRevenue,
    recentCustomers: rows.slice(0, 5).map((r) => ({ id: r.id, name: r.name, joinedAt: r.joinedAt, isReturning: r.isReturning }))
  };
}

function computeReturns(returnsInRange: ReturnRequest[]): DashboardReturnsOverview {
  const statusCounts = new Map<(typeof RETURN_STATUS_VALUES)[number], number>(RETURN_STATUS_VALUES.map((s) => [s, 0]));
  returnsInRange.forEach((r) => statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1));

  return {
    open: returnsInRange.filter((r) => r.status === "requested" || r.status === "approved").length,
    statusBreakdown: RETURN_STATUS_VALUES.map((status) => ({ status, count: statusCounts.get(status) ?? 0 }))
  };
}

function computeProductPerformance(orders: Order[], returnsInRange: ReturnRequest[]): DashboardProductPerformanceRow[] {
  const byProduct = new Map<number, { name: string; unitsSold: number; revenue: number }>();
  orders.forEach((o) => {
    for (const item of o.items ?? []) {
      if (!item.product_id) continue;
      const entry = byProduct.get(item.product_id) ?? { name: item.product_name, unitsSold: 0, revenue: 0 };
      entry.unitsSold += item.quantity;
      entry.revenue += Number(item.line_total);
      byProduct.set(item.product_id, entry);
    }
  });

  const returnCountByProduct = new Map<number, number>();
  returnsInRange.forEach((r) => {
    const productId = r.orderItem?.product_id;
    if (!productId) return;
    returnCountByProduct.set(productId, (returnCountByProduct.get(productId) ?? 0) + 1);
  });

  return [...byProduct.entries()]
    .map(([productId, v]) => ({
      productId,
      name: v.name,
      unitsSold: v.unitsSold,
      revenue: v.revenue,
      returnRequests: returnCountByProduct.get(productId) ?? 0
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20);
}

function computeInsights(params: {
  summary: DashboardSummaryJSON["summary"];
  productPerformance: DashboardProductPerformanceRow[];
  locations: DashboardLocationRow[];
  compare: boolean;
}): DashboardInsight[] {
  const { summary, productPerformance, locations, compare } = params;
  const insights: DashboardInsight[] = [];

  if (compare && summary.grossSales.changePct !== null && Math.abs(summary.grossSales.changePct) >= 5) {
    insights.push({
      id: "sales-change",
      tone: summary.grossSales.changePct >= 0 ? "positive" : "warning",
      text: `Gross sales ${summary.grossSales.changePct >= 0 ? "rose" : "fell"} ${Math.abs(summary.grossSales.changePct)}% versus the previous period.`
    });
  }

  if (productPerformance.length && productPerformance[0]!.revenue > 0) {
    const top = productPerformance[0]!;
    insights.push({ id: "top-product", tone: "positive", text: `${top.name} is the top-performing product with ${currency.format(top.revenue)} in revenue.` });
  }

  if (locations.length && locations[0]!.revenue > 0) {
    const top = locations[0]!;
    insights.push({
      id: "top-location",
      tone: "neutral",
      text: `${top.city}, ${top.state} leads with ${currency.format(top.revenue)} in revenue from ${top.orders} order${top.orders === 1 ? "" : "s"}.`
    });
  }

  if (compare && summary.openReturns.changePct !== null && summary.openReturns.changePct >= 25 && summary.openReturns.value >= 2) {
    insights.push({ id: "returns-spike", tone: "warning", text: `Return requests increased ${summary.openReturns.changePct}% versus the previous period.` });
  }

  return insights;
}

async function computeRangeAggregates(from: Date, to: Date, query: DashboardQuery) {
  const allOrders = await loadOrdersInRange(from, to, query);
  const revenueOrders = query.orderStatus === "cancelled" ? allOrders : allOrders.filter((o) => o.status !== "cancelled");
  const paidOrders = revenueOrders.filter((o) => o.payment_status === "paid");

  const grossSalesValue = sumBy(paidOrders, (o) => Number(o.total));
  const identities = new Set<string>();
  revenueOrders.forEach((o) => identities.add(o.user_id ? `user:${o.user_id}` : `guest:${o.contact_email ?? o.id}`));

  return { allOrders, revenueOrders, paidOrders, grossSalesValue, customerCount: identities.size };
}

export const DashboardService = {
  async getFilterOptions(): Promise<DashboardFilterOptionsJSON> {
    const [products, stateRows] = await Promise.all([
      Product.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] }),
      sequelize.query<{ ship_state: string }>("SELECT DISTINCT `ship_state` FROM `orders` ORDER BY `ship_state` ASC", { type: QueryTypes.SELECT })
    ]);

    return {
      products: products.map((p) => ({ id: p.id, name: p.name })),
      states: stateRows.map((r) => r.ship_state),
      orderStatuses: [...ORDER_STATUS_VALUES]
    };
  },

  async getSummary(query: DashboardQuery): Promise<DashboardSummaryJSON> {
    const from = startOfDayUTC(new Date(query.from));
    const to = endOfDayUTC(new Date(query.to));
    const now = new Date();

    const current = await computeRangeAggregates(from, to, query);
    const returnsInRange = await loadReturnsInRange(from, to, query);

    let previous: Awaited<ReturnType<typeof computeRangeAggregates>> | null = null;
    let previousReturnsOpen = 0;
    if (query.compare) {
      const prevRange = resolvePreviousRange(from, to);
      previous = await computeRangeAggregates(prevRange.from, prevRange.to, query);
      const prevReturns = await loadReturnsInRange(prevRange.from, prevRange.to, query);
      previousReturnsOpen = prevReturns.filter((r) => r.status === "requested" || r.status === "approved").length;
    }

    const compare = Boolean(query.compare);
    const openReturns = returnsInRange.filter((r) => r.status === "requested" || r.status === "approved").length;

    const summary: DashboardSummaryJSON["summary"] = {
      grossSales: comparisonOf(current.grossSalesValue, previous?.grossSalesValue ?? 0, compare),
      orders: comparisonOf(current.revenueOrders.length, previous?.revenueOrders.length ?? 0, compare),
      averageOrderValue: comparisonOf(
        round1(current.paidOrders.length > 0 ? current.grossSalesValue / current.paidOrders.length : 0),
        round1(previous && previous.paidOrders.length > 0 ? previous.grossSalesValue / previous.paidOrders.length : 0),
        compare
      ),
      customers: comparisonOf(current.customerCount, previous?.customerCount ?? 0, compare),
      openReturns: comparisonOf(openReturns, previousReturnsOpen, compare)
    };

    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    const groupBy: "day" | "week" = spanDays > 31 ? "week" : "day";
    const prevRangeForSeries = query.compare ? resolvePreviousRange(from, to) : null;

    const timeSeries: DashboardSummaryJSON["timeSeries"] = {
      current: fillSeries(buildBuckets(from, to, groupBy), current.revenueOrders),
      previous: previous && prevRangeForSeries ? fillSeries(buildBuckets(prevRangeForSeries.from, prevRangeForSeries.to, groupBy), previous.revenueOrders) : [],
      groupBy
    };

    const orderStatus = computeOrderStatusSlices(current.allOrders);
    const recentOrders = computeRecentOrders(current.allOrders);
    const fulfilment = computeFulfilment(current.revenueOrders, now);
    const locations = computeLocations(current.revenueOrders);
    const customerOverview = await computeCustomerOverview(current.revenueOrders, from);
    const returns = computeReturns(returnsInRange);
    const productPerformance = computeProductPerformance(current.revenueOrders, returnsInRange);
    const insights = computeInsights({ summary, productPerformance, locations, compare });

    return {
      isEmpty: current.allOrders.length === 0,
      summary,
      timeSeries,
      orderStatus,
      recentOrders,
      fulfilment,
      locations,
      customerOverview,
      returns,
      productPerformance,
      insights
    };
  }
};

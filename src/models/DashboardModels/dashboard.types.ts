import type { OrderStatus } from "../../constants/database.constants.js";

export type MetricComparison = {
  value: number;
  previousValue: number;
  changePct: number | null;
};

export type DashboardTimeSeriesPoint = {
  date: string;
  label: string;
  sales: number;
  orders: number;
  units: number;
};

export type DashboardOrderStatusSlice = {
  status: OrderStatus;
  count: number;
  percentage: number;
};

export type DashboardOrderRow = {
  orderId: number;
  orderNumber: string;
  customerLabel: string;
  total: number;
  status: OrderStatus;
  placedAt: string;
  itemCount: number;
};

export type DashboardFulfilment = {
  awaitingFulfilment: number;
  packed: number;
  shipped: number;
  delivered: number;
  delayed: number;
  avgProcessingHours: number;
  avgDeliveryDays: number;
  standardOrders: number;
  expressOrders: number;
};

export type DashboardLocationRow = {
  state: string;
  city: string;
  orders: number;
  customers: number;
  revenue: number;
  averageOrderValue: number;
};

export type DashboardRecentCustomer = {
  id: number;
  name: string;
  joinedAt: string;
  isReturning: boolean;
};

export type DashboardCustomerOverview = {
  newCustomers: number;
  returningCustomers: number;
  firstTimeBuyers: number;
  repeatPurchaseRate: number;
  returningCustomerRevenue: number;
  recentCustomers: DashboardRecentCustomer[];
};

export type DashboardReturnsOverview = {
  open: number;
  statusBreakdown: { status: "requested" | "approved" | "rejected" | "resolved" | "cancelled"; count: number }[];
};

export type DashboardProductPerformanceRow = {
  productId: number;
  name: string;
  unitsSold: number;
  revenue: number;
  returnRequests: number;
};

export type DashboardInsight = {
  id: string;
  tone: "positive" | "warning" | "neutral";
  text: string;
};

export type DashboardSummaryJSON = {
  isEmpty: boolean;
  summary: {
    grossSales: MetricComparison;
    orders: MetricComparison;
    averageOrderValue: MetricComparison;
    customers: MetricComparison;
    openReturns: MetricComparison;
  };
  timeSeries: {
    current: DashboardTimeSeriesPoint[];
    previous: DashboardTimeSeriesPoint[];
    groupBy: "day" | "week";
  };
  orderStatus: DashboardOrderStatusSlice[];
  recentOrders: DashboardOrderRow[];
  fulfilment: DashboardFulfilment;
  locations: DashboardLocationRow[];
  customerOverview: DashboardCustomerOverview;
  returns: DashboardReturnsOverview;
  productPerformance: DashboardProductPerformanceRow[];
  insights: DashboardInsight[];
};

export type DashboardFilterOptionsJSON = {
  products: { id: number; name: string }[];
  states: string[];
  orderStatuses: OrderStatus[];
};

export type DashboardQuery = {
  from: string;
  to: string;
  compare?: boolean;
  productId?: number;
  orderStatus?: OrderStatus;
  state?: string;
};

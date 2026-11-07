"use client";

import { useState } from "react";
import { Banknote, ChartColumn, Package, PackageSearch, ShoppingCart, Store, Truck, TriangleAlert, Warehouse as WarehouseIcon } from "lucide-react";
import { ErrorState, KpiCard, PageHeader, SkeletonRows, StatGrid, TabPanel, Tabs } from "@/components/ui";
import { Counter } from "@/components/pos/counter";
import { Products, Purchases, Stock, Vendors } from "@/components/pos/manage";
import { PosReports } from "@/components/pos/reports";
import type { Dashboard, Warehouse } from "@/components/pos/types";
import { rupees } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "counter" | "products" | "stock" | "purchases" | "vendors" | "reports";

export default function PosPage() {
  const user = useSession();
  const warehouses = useApi<Warehouse[]>("/pos/warehouses");
  const dash = useApi<Dashboard>("/pos/reports/dashboard");
  const [tab, setTab] = useState<Tab>("counter");
  const d = dash.data;
  const loading = !d && !dash.error;
  const reloadAll = async () => {
    await Promise.all([dash.reload(), warehouses.reload()]);
  };
  const tabs = [
    { value: "counter", label: "Counter", icon: <ShoppingCart /> },
    { value: "products", label: "Products", icon: <Package /> },
    { value: "stock", label: "Stock", icon: <WarehouseIcon /> },
    { value: "purchases", label: "Purchases", icon: <Truck /> },
    { value: "vendors", label: "Vendors", icon: <Store /> },
    { value: "reports", label: "Reports", icon: <ChartColumn /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Canteen and shop" description="Sell at the counter, keep stock in each store and track what you buy from vendors." breadcrumbs={[{ label: "Operations" }, { label: "Canteen and shop" }]} />
      {dash.error ? (
        <ErrorState compact message={dash.error} onRetry={dash.reload} />
      ) : (
        <StatGrid>
          <KpiCard label="Sales today" value={rupees(d?.today.revenue ?? 0)} icon={<ShoppingCart />} loading={loading} hint={d ? `${d.today.sales} sales, ${rupees(d.today.profit)} profit` : undefined} />
          <KpiCard label="Stock at cost" value={rupees(d?.stockValue ?? 0)} icon={<PackageSearch />} tone="info" loading={loading} hint={d ? `${d.lowStock} running low` : undefined} />
          <KpiCard label="Students owe" value={rupees(d?.receivables ?? 0)} icon={<TriangleAlert />} tone="warning" loading={loading} />
          <KpiCard label="We owe vendors" value={rupees(d?.payables ?? 0)} icon={<Banknote />} tone="neutral" loading={loading} />
        </StatGrid>
      )}
      <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as Tab)} aria-label="Canteen sections">
        {warehouses.data ? (
          <>
            <TabPanel value="counter"><Counter warehouses={warehouses.data} onChange={reloadAll} /></TabPanel>
            <TabPanel value="products"><Products warehouses={warehouses.data} onChange={reloadAll} /></TabPanel>
            <TabPanel value="stock"><Stock warehouses={warehouses.data} canSetUp={hasRole(user, SETUP)} onChange={reloadAll} /></TabPanel>
            <TabPanel value="purchases"><Purchases warehouses={warehouses.data} onChange={reloadAll} /></TabPanel>
            <TabPanel value="vendors"><Vendors onChange={reloadAll} /></TabPanel>
            <TabPanel value="reports"><PosReports /></TabPanel>
          </>
        ) : warehouses.error ? (
          <ErrorState compact message={warehouses.error} onRetry={warehouses.reload} />
        ) : (
          <SkeletonRows rows={4} columns={3} />
        )}
      </Tabs>
    </div>
  );
}

export interface Warehouse { id: string; name: string; campusId: string | null; active: boolean }
export interface Item {
  id: string; name: string; barcode: string | null; category: string | null; brand: string | null;
  unit: string; costPrice: number; salePrice: number; reorderLevel: number; active: boolean; onHand: number;
}
export interface Vendor { id: string; name: string; phone: string | null; address: string | null; notes: string | null; active: boolean; owed: number }
export interface StockRow { itemId: string; name: string; category: string | null; warehouseId: string; warehouse: string; qty: number; reorderLevel: number; low: boolean; value: number }
export interface SaleRow {
  id: string; number: string; createdAt: string; payment: "CASH" | "ON_ACCOUNT"; total: number; discount: number;
  settledAt: string | null; voidedAt: string | null; studentName: string | null; customerName: string | null;
  warehouse: { name: string }; lines: { id: string; itemName: string; qty: number; unitPrice: number }[];
}
export interface PurchaseRow {
  id: string; number: string; purchasedOn: string; total: number; paid: number;
  vendor: { name: string }; warehouse: { name: string }; lines: { id: string; qty: number; unitCost: number }[];
}
export interface Customer { id: string; name: string; admissionNo: string; class: string | null; onAccount: number }
export interface Dashboard {
  today: { sales: number; revenue: number; profit: number };
  month: { sales: number; revenue: number; profit: number };
  stockValue: number; lowStock: number; receivables: number; payables: number;
}

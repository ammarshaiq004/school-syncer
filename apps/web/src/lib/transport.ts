export interface Stop {
  id: string;
  name: string;
  position: number;
  pickupTime: string | null;
  dropTime: string | null;
  monthlyFee: number | null;
  riders?: number;
}

export interface Vehicle {
  id: string;
  registrationNo: string;
  type: "VAN" | "COASTER" | "BUS" | "CAR";
  capacity: number;
  driverName: string;
  driverPhone: string;
  driverCnic: string | null;
  conductorName: string | null;
  conductorPhone: string | null;
  isActive: boolean;
  routes?: { id: string; name: string }[];
}

export interface Route {
  id: string;
  name: string;
  campusId: string | null;
  campus: { name: string } | null;
  vehicleId: string | null;
  vehicle: Vehicle | null;
  monthlyFee: number;
  isActive: boolean;
  stops: Stop[];
  riders: number;
  monthlyBilling: number;
}

export const VEHICLE_TYPES = [
  { value: "VAN", label: "Van" },
  { value: "COASTER", label: "Coaster" },
  { value: "BUS", label: "Bus" },
  { value: "CAR", label: "Car" },
];

export const vehicleLabel = (v: Pick<Vehicle, "registrationNo" | "type">) =>
  `${VEHICLE_TYPES.find((t) => t.value === v.type)?.label ?? v.type} ${v.registrationNo}`;

/** "Expo Centre (07:05 / 14:20)" */
export const stopLabel = (s: Pick<Stop, "name" | "pickupTime" | "dropTime">) =>
  s.pickupTime || s.dropTime ? `${s.name} (${s.pickupTime ?? "–"} / ${s.dropTime ?? "–"})` : s.name;

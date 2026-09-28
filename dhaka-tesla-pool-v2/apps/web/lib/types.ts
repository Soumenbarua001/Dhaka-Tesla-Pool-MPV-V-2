export type User = {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER";
  walletBalancePaisa: number;
};

export type Ride = {
  id: string;
  pickupZone: string;
  dropoffZone: string;
  seats: number;
  status: string;
  estimatedFarePaisa: number;
  finalFarePaisa: number | null;
  paymentMethod: string;
  createdAt: string;
  poolId: string | null;
  poolStatus: string | null;
  vehicleName: string | null;
  driverName: string | null;
};

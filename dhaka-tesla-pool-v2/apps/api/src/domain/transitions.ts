export type PoolStatus = "MATCHING" | "ACCEPTED" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";
export type RideStatus = "REQUESTED" | "MATCHED" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";

const poolTransitions: Record<PoolStatus, readonly PoolStatus[]> = {
  MATCHING: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["DRIVER_ARRIVED"],
  DRIVER_ARRIVED: ["STARTED"],
  STARTED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionPool(from: PoolStatus, to: PoolStatus): boolean {
  return poolTransitions[from].includes(to);
}

export function rideStatusForPoolStatus(status: PoolStatus): RideStatus | null {
  switch (status) {
    case "DRIVER_ARRIVED": return "DRIVER_ARRIVED";
    case "STARTED": return "STARTED";
    case "COMPLETED": return "COMPLETED";
    default: return null;
  }
}

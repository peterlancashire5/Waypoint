// Simple in-memory trip store — persists for the current session only.

export interface StoredTrip {
  id: string;
  name: string;
  type: 'single' | 'multi';
  status: 'Upcoming';
  dateRange: string;
  stopCount: number;
  chips: string[]; // city names shown as chips on the card
}

let trips: StoredTrip[] = [];

export function addTrip(trip: Omit<StoredTrip, 'id'>): StoredTrip {
  const stored: StoredTrip = { ...trip, id: `trip_${Date.now()}` };
  trips = [stored, ...trips];
  return stored;
}

export function getTrips(): StoredTrip[] {
  return trips;
}

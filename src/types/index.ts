export type UserRole = 'ATTENDEE' | 'ORGANIZER';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type EventStatus = 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';

export interface EventItem {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  category: string;
  city: string;
  venue: string;
  date: string; // ISO string
  ticket_price: number;
  total_capacity: number;
  available_seats: number;
  status: EventStatus;
  created_at: string;
  updated_at: string;
}

export type BookingStatus = 'CONFIRMED' | 'CANCELLED' | 'REFUNDED';

export interface Booking {
  id: string;
  event_id: string;
  user_id: string;
  ticket_quantity: number;
  total_price: number;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  family: string;
  is_revoked: number; // 0 or 1
  expires_at: string;
  created_at: string;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SalesSummary {
  eventId: string;
  title: string;
  status: EventStatus;
  ticketPrice: number;
  totalCapacity: number;
  availableSeats: number;
  ticketsSold: number;
  totalRevenue: number;
  activeBookingsCount: number;
  refundedBookingsCount: number;
  cancelledBookingsCount: number;
}

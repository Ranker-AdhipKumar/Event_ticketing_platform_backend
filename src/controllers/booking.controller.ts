import type { Request, Response, NextFunction } from 'express';
import { BookingService } from '../services/booking.service.js';

export class BookingController {
  static async createBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await BookingService.createBooking(req.user!.userId, req.body);
      res.status(201).json({
        success: true,
        message: 'Ticket(s) booked successfully',
        data: {
          booking: result.booking,
          remainingSeats: result.remainingSeats,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async cancelBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await BookingService.cancelBooking(String(req.params.id), req.user!.userId);
      res.status(200).json({
        success: true,
        message: 'Booking cancelled successfully. Seats have been restored.',
        data: {
          booking: result.booking,
          restoredSeats: result.restoredSeats,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getMyBookings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await BookingService.getUserBookings(req.user!.userId, req.query as any);
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getEventBookings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await BookingService.getEventBookingsForOrganizer(
        String(req.params.id),
        req.user!.userId,
        req.query as any
      );
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
}

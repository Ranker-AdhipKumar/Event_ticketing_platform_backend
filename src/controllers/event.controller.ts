import type { Request, Response, NextFunction } from 'express';
import { EventService } from '../services/event.service.js';

export class EventController {
  static async listEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await EventService.listEvents(req.query as any);
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async searchEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = (req.query.q as string) || '';
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await EventService.searchEvents(query, page, limit);
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getEventById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const eventId = String(req.params.id);
      const event = await EventService.getEventById(eventId);
      res.status(200).json({
        success: true,
        data: event,
      });
    } catch (error) {
      next(error);
    }
  }

  static async createEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await EventService.createEvent(req.user!.userId, req.body);
      res.status(201).json({
        success: true,
        message: 'Event created successfully',
        data: event,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await EventService.updateEvent(String(req.params.id), req.user!.userId, req.body);
      res.status(200).json({
        success: true,
        message: 'Event updated successfully',
        data: event,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await EventService.deleteEvent(String(req.params.id), req.user!.userId);
      res.status(200).json({
        success: true,
        message: 'Event deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  static async cancelEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await EventService.cancelEvent(String(req.params.id), req.user!.userId);
      res.status(200).json({
        success: true,
        message: `Event cancelled successfully. ${result.refundedCount} active booking(s) refunded.`,
        data: result.event,
        refundedBookingsCount: result.refundedCount,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getSalesSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const summary = await EventService.getOrganizerSalesSummary(
        req.user!.userId,
        String(req.params.id)
      );
      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getMyEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const result = await EventService.getOrganizerEvents(req.user!.userId, page, limit);

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

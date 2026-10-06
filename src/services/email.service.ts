import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import type { Booking, EventItem, User } from '../types/index.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  sentAt: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  public outbox: EmailMessage[] = [];

  constructor() {
    this.initTransporter();
  }

  private initTransporter(): void {
    if (config.smtp.host && config.env !== 'test') {
      try {
        this.transporter = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.port === 465,
          auth:
            config.smtp.user && config.smtp.pass
              ? { user: config.smtp.user, pass: config.smtp.pass }
              : undefined,
        });
      } catch {
        this.transporter = null;
      }
    }
  }

  async sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
    const message: EmailMessage = {
      to,
      subject,
      text,
      html,
      sentAt: new Date().toISOString(),
    };

    this.outbox.push(message);

    if (config.env !== 'test') {
      console.log(`[EmailService] ✉️ Email sent to ${to} | Subject: "${subject}"`);
    }

    if (this.transporter && process.env.NODE_ENV !== 'test') {
      try {
        await this.transporter.sendMail({
          from: config.smtp.from,
          to,
          subject,
          text,
          html,
        });
      } catch (err: any) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[EmailService] Failed to send via SMTP transport: ${err.message}`);
        }
      }
    }
  }

  async sendBookingConfirmation(booking: Booking, event: EventItem, user: { email: string; name: string }): Promise<void> {
    const subject = `Booking Confirmation: ${event.title} (#${booking.id.slice(0, 8)})`;
    const text = `
Hello ${user.name},

Your ticket booking has been confirmed!

Event: ${event.title}
Date & Time: ${new Date(event.date).toUTCString()}
Venue: ${event.venue}, ${event.city}
Tickets: ${booking.ticket_quantity}
Total Paid: $${Number(booking.total_price).toFixed(2)}
Booking Reference: ${booking.id}

Thank you for booking with us!
`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
  <h2 style="color: #2b6cb0;">🎉 Booking Confirmed!</h2>
  <p>Hi <strong>${user.name}</strong>,</p>
  <p>We're thrilled to confirm your ticket reservation for <strong>${event.title}</strong>.</p>
  
  <div style="background-color: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
    <p style="margin: 5px 0;"><strong>📅 Date & Time:</strong> ${new Date(event.date).toUTCString()}</p>
    <p style="margin: 5px 0;"><strong>📍 Venue:</strong> ${event.venue}, ${event.city}</p>
    <p style="margin: 5px 0;"><strong>🎟️ Ticket Count:</strong> ${booking.ticket_quantity}</p>
    <p style="margin: 5px 0;"><strong>💳 Total Amount:</strong> $${Number(booking.total_price).toFixed(2)}</p>
    <p style="margin: 5px 0;"><strong>🔖 Booking ID:</strong> <code>${booking.id}</code></p>
  </div>
  
  <p style="color: #718096; font-size: 13px;">Please show your booking reference upon arrival at the venue.</p>
</div>
`;

    await this.sendEmail(user.email, subject, text, html);
  }

  async sendBookingCancellation(booking: Booking, event: EventItem, user: { email: string; name: string }): Promise<void> {
    const subject = `Booking Cancelled: ${event.title} (#${booking.id.slice(0, 8)})`;
    const text = `
Hello ${user.name},

Your booking #${booking.id} for "${event.title}" has been cancelled.
The seats have been released back to the event.

Booking ID: ${booking.id}
`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
  <h2 style="color: #c53030;">Booking Cancelled</h2>
  <p>Hi <strong>${user.name}</strong>,</p>
  <p>Your booking for <strong>${event.title}</strong> has been successfully cancelled.</p>
  <p>Booking ID: <code>${booking.id}</code></p>
</div>
`;

    await this.sendEmail(user.email, subject, text, html);
  }

  async sendEventCancellationRefund(booking: Booking, event: EventItem, userEmail: string): Promise<void> {
    const subject = `Event Cancelled & Refund Processed: ${event.title}`;
    const text = `
Important Notice:
The event "${event.title}" scheduled for ${new Date(event.date).toUTCString()} has been cancelled by the organizer.
A full refund of $${Number(booking.total_price).toFixed(2)} for your booking #${booking.id} has been initiated.
`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
  <h2 style="color: #c53030;">⚠️ Event Cancelled & Full Refund Issued</h2>
  <p>We regret to inform you that the organizer has cancelled <strong>${event.title}</strong>.</p>
  <p>A full refund of <strong>$${Number(booking.total_price).toFixed(2)}</strong> for booking reference <code>${booking.id}</code> is currently being refunded to your original payment method.</p>
</div>
`;

    await this.sendEmail(userEmail, subject, text, html);
  }

  clearOutbox(): void {
    this.outbox = [];
  }
}

export const emailService = new EmailService();

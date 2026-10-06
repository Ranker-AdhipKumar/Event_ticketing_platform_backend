export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Event Ticketing Platform API',
    version: '1.0.0',
    description: `
Production-grade RESTful API for an Event Ticketing Platform.

### Key Architectural Features:
- **Role-Based Access Control (RBAC):** Strict separation between \`ATTENDEE\` and \`ORGANIZER\` roles.
- **Concurrency-Safe Atomic Booking:** Pessimistic row-level locking / atomic conditional database checks prevent overbooking under intense parallel traffic for remaining seats.
- **Refresh Token Rotation & Revocation:** Secure session management with automatic reuse detection that invalidates compromised token families.
- **Sliding-Window Rate Limiting:** 5 bookings/min limit per user to deter bots and scalpers.
- **Event Lifecycle & Cascade Refunds:** Organizers cancelling events triggers an atomic cascade refunding all active attendee bookings and notifying them.
- **Automated Lifecycle Worker:** Background cron sweeper automatically moves elapsed events to \`COMPLETED\`.
- **Intelligent Query Caching:** Redis caching for public listings with instant invalidation upon organizer updates.
    `,
    contact: {
      name: 'Engineering Team',
      email: 'engineering@eventticketing.example.com',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Provide JWT access token in Authorization header: Bearer <token>',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'INSUFFICIENT_CAPACITY' },
              message: { type: 'string', example: 'Insufficient capacity. Only 2 seat(s) remaining.' },
              details: { type: 'object' },
            },
            required: ['code', 'message'],
          },
        },
        required: ['success', 'error'],
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 45 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          totalPages: { type: 'integer', example: 5 },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
          email: { type: 'string', format: 'email', example: 'alex@example.com' },
          name: { type: 'string', example: 'Alex Smith' },
          role: { type: 'string', enum: ['ATTENDEE', 'ORGANIZER'], example: 'ATTENDEE' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Event: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
          organizer_id: { type: 'string', format: 'uuid' },
          title: { type: 'string', example: 'Rock Festival 2026' },
          description: { type: 'string', example: 'An epic open air music festival.' },
          category: { type: 'string', example: 'Concert' },
          city: { type: 'string', example: 'San Francisco' },
          venue: { type: 'string', example: 'Golden Gate Park' },
          date: { type: 'string', format: 'date-time', example: '2026-11-20T19:00:00.000Z' },
          ticket_price: { type: 'number', example: 75.0 },
          total_capacity: { type: 'integer', example: 500 },
          available_seats: { type: 'integer', example: 420 },
          status: { type: 'string', enum: ['PUBLISHED', 'CANCELLED', 'COMPLETED'], example: 'PUBLISHED' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          event_id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          ticket_quantity: { type: 'integer', example: 2 },
          total_price: { type: 'number', example: 150.0 },
          status: { type: 'string', enum: ['CONFIRMED', 'CANCELLED', 'REFUNDED'], example: 'CONFIRMED' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      SalesSummary: {
        type: 'object',
        properties: {
          eventId: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          status: { type: 'string' },
          ticketPrice: { type: 'number' },
          totalCapacity: { type: 'integer' },
          availableSeats: { type: 'integer' },
          ticketsSold: { type: 'integer' },
          totalRevenue: { type: 'number' },
          activeBookingsCount: { type: 'integer' },
          refundedBookingsCount: { type: 'integer' },
          cancelledBookingsCount: { type: 'integer' },
        },
      },
      RegisterInput: {
        type: 'object',
        required: ['email', 'password', 'name', 'role'],
        properties: {
          email: { type: 'string', format: 'email', example: 'organizer@acme.com' },
          password: { type: 'string', minLength: 8, example: 'Password123' },
          name: { type: 'string', example: 'Acme Events Inc.' },
          role: { type: 'string', enum: ['ATTENDEE', 'ORGANIZER'], example: 'ORGANIZER' },
        },
      },
      LoginInput: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'organizer@acme.com' },
          password: { type: 'string', example: 'Password123' },
        },
      },
      RefreshTokenInput: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string', example: 'a9b8c7d6e5...' },
        },
      },
      CreateEventInput: {
        type: 'object',
        required: ['title', 'description', 'category', 'city', 'venue', 'date', 'ticketPrice', 'totalCapacity'],
        properties: {
          title: { type: 'string', example: 'Global Tech Summit 2026' },
          description: { type: 'string', example: 'Annual technology and AI developer conference.' },
          category: { type: 'string', example: 'Conference' },
          city: { type: 'string', example: 'Seattle' },
          venue: { type: 'string', example: 'Convention Center Hall A' },
          date: { type: 'string', format: 'date-time', example: '2026-12-15T09:00:00Z' },
          ticketPrice: { type: 'number', minimum: 0, example: 199.99 },
          totalCapacity: { type: 'integer', minimum: 1, example: 300 },
        },
      },
      CreateBookingInput: {
        type: 'object',
        required: ['eventId', 'ticketQuantity'],
        properties: {
          eventId: { type: 'string', format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
          ticketQuantity: { type: 'integer', minimum: 1, maximum: 20, example: 2 },
        },
      },
    },
  },
  paths: {
    '/api/auth/register': {
      post: {
        summary: 'Register a new user account',
        description: 'Creates a new Attendee or Organizer account with hashed password and generates initial JWT tokens.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterInput' } } },
        },
        responses: {
          201: { description: 'User successfully registered' },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          409: { description: 'Email address already exists' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Authenticate user credentials',
        description: 'Validates email and password, returning short-lived JWT access token and refresh token.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } },
        },
        responses: {
          200: { description: 'Authentication successful' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        summary: 'Rotate refresh token and issue new access token',
        description: 'Performs refresh token rotation with token reuse detection to safeguard sessions against theft.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenInput' } } },
        },
        responses: {
          200: { description: 'New token pair issued' },
          401: { description: 'Invalid or reused refresh token' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        summary: 'Revoke refresh token session',
        description: 'Revokes the active refresh token session family.',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenInput' } } },
        },
        responses: {
          200: { description: 'Successfully logged out' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        summary: 'Get current authenticated user profile',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'User profile retrieved' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/events': {
      get: {
        summary: 'Browse and filter events',
        description: 'Public endpoint to browse events with multi-criteria filtering, price range, and pagination.',
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'city', in: 'query', schema: { type: 'string' } },
          { name: 'minPrice', in: 'query', schema: { type: 'number' } },
          { name: 'maxPrice', in: 'query', schema: { type: 'number' } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
        ],
        responses: {
          200: { description: 'Filtered list of events' },
        },
      },
      post: {
        summary: 'Create a new event',
        description: 'Only accessible by authenticated ORGANIZER users.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEventInput' } } },
        },
        responses: {
          201: { description: 'Event created successfully' },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden (Attendee not permitted)' },
        },
      },
    },
    '/api/events/search': {
      get: {
        summary: 'Search events by keyword',
        description: 'Searches event title and description.',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
        ],
        responses: {
          200: { description: 'Matching events list' },
        },
      },
    },
    '/api/events/my-events': {
      get: {
        summary: 'List events created by current organizer',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Organizer events list' },
        },
      },
    },
    '/api/events/{id}': {
      get: {
        summary: 'Get event details and real-time remaining capacity',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Event details' },
          404: { description: 'Event not found' },
        },
      },
      put: {
        summary: 'Update event details',
        description: 'Organizer only. Cannot modify events that have completed or cancelled.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          200: { description: 'Event updated' },
          403: { description: 'Forbidden (Not owner)' },
        },
      },
      delete: {
        summary: 'Delete event',
        description: 'Organizer only. Allowed only when no confirmed bookings exist.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Event deleted' },
          400: { description: 'Cannot delete event with active bookings' },
        },
      },
    },
    '/api/events/{id}/cancel': {
      post: {
        summary: 'Cancel event and cascade refund to all attendees',
        description: 'Organizer only. Updates event to CANCELLED and cascades REFUNDED status to all bookings atomically.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Event cancelled and bookings refunded' },
        },
      },
    },
    '/api/events/{id}/summary': {
      get: {
        summary: 'Get organizer sales summary for an event',
        description: 'Returns tickets sold, gross revenue, remaining capacity, and booking breakdowns.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Sales summary data', content: { 'application/json': { schema: { $ref: '#/components/schemas/SalesSummary' } } } },
        },
      },
    },
    '/api/events/{id}/bookings': {
      get: {
        summary: 'List all bookings made for an organizer event',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'List of bookings with attendee information' },
        },
      },
    },
    '/api/bookings': {
      post: {
        summary: 'Book tickets for an event (Concurrency-safe)',
        description: 'Attendee only. Protected by 5/min rate limiter and atomic capacity lock. Returns remaining capacity.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateBookingInput' } } },
        },
        responses: {
          201: { description: 'Tickets successfully booked' },
          400: { description: 'Event inactive or already started' },
          409: { description: 'Insufficient capacity (overbooking prevented)' },
          429: { description: 'Rate limit exceeded (5 requests/minute)' },
        },
      },
      get: {
        summary: 'Get personal booking history',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Attendee booking history' },
        },
      },
    },
    '/api/bookings/{id}/cancel': {
      post: {
        summary: 'Cancel booking within permitted cancellation window',
        description: 'Attendee only. Cancels booking and restores tickets to event capacity if event is at least 24h away.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Booking cancelled and seats restored' },
          400: { description: 'Cancellation window expired or booking not confirmed' },
        },
      },
    },
  },
};
